import { createHmac } from "node:crypto";
import { Types } from "mongoose";
import { toGeoJsonPoint } from "@foodify/validation";
import type {
  OrderStatus,
  PlaceOrderInput,
  UpdateOrderStatusInput,
  VerifyPaymentInput,
} from "@foodify/validation";
import { getRazorpay } from "../config/razorpay.js";
import { env } from "../config/env.js";
import { emitToUser } from "../events/socket.js";
import { defaultDispatchConfig } from "../config/dispatch.js";
import { acceptOffer, cancelDispatch, enqueueDispatch, getOffersForPartner, markPickedUp } from "./dispatch/dispatch.service.js";
import DeliveryAssignment from "../models/deliveryAssignment.model.js";
import Item from "../models/item.model.js";
import Order, { type IShopOrder, type OrderDocument } from "../models/order.model.js";
import Shop from "../models/shop.model.js";
import User, { type UserRole } from "../models/user.model.js";
import { AppError } from "../utils/AppError.js";
import { generateNumericCode, safeEqual, sha256 } from "../utils/crypto.js";
import { sendDeliveryOtpMail } from "../utils/mail.js";
import { notify } from "./notification.service.js";
import { assertTransition } from "./orderStateMachine.js";
import { calculateDeliveryFee, round2 } from "./pricing.js";

const DELIVERY_OTP_TTL_MS = 5 * 60 * 1000;
const DELIVERY_OTP_MAX_ATTEMPTS = 5;
const MY_ORDERS_LIMIT = 100;

const isDuplicateKey = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === 11000;

const id = (value: unknown): string => String(value);

/* ------------------------------------------------------------------ */
/* Placing an order                                                    */
/* ------------------------------------------------------------------ */

type PricedShopOrder = {
  shop: Types.ObjectId;
  owner: Types.ObjectId;
  subtotal: number;
  shopOrderItems: { item: Types.ObjectId; name: string; price: number; quantity: number }[];
};

/** Builds shop orders from trusted database prices. Nothing price-related comes from the client. */
const priceCart = async (cartItems: PlaceOrderInput["cartItems"]) => {
  const quantities = new Map<string, number>();
  for (const line of cartItems) {
    quantities.set(line.id, (quantities.get(line.id) ?? 0) + line.quantity);
  }

  const items = await Item.find({ _id: { $in: [...quantities.keys()] } }).lean();
  if (items.length !== quantities.size) {
    throw AppError.badRequest("Some items in your cart no longer exist", "ITEM_NOT_FOUND");
  }
  const unavailable = items.filter((i) => i.isAvailable === false);
  if (unavailable.length > 0) {
    throw AppError.conflict(
      `Currently unavailable: ${unavailable.map((i) => i.name).join(", ")}`,
      "ITEM_UNAVAILABLE",
    );
  }

  const shops = await Shop.find({ _id: { $in: items.map((i) => i.shop) } })
    .select("owner")
    .lean();
  const ownerByShop = new Map(shops.map((s) => [id(s._id), s.owner]));

  const byShop = new Map<string, PricedShopOrder>();
  for (const item of items) {
    const shopId = id(item.shop);
    const owner = ownerByShop.get(shopId);
    if (!owner) throw AppError.badRequest("Some items belong to a shop that no longer exists");

    const quantity = quantities.get(id(item._id)) ?? 0;
    const entry =
      byShop.get(shopId) ??
      { shop: item.shop, owner, subtotal: 0, shopOrderItems: [] };
    entry.shopOrderItems.push({ item: item._id, name: item.name, price: item.price, quantity });
    entry.subtotal = round2(entry.subtotal + item.price * quantity);
    byShop.set(shopId, entry);
  }

  const shopOrders = [...byShop.values()];
  const itemsTotal = round2(shopOrders.reduce((sum, so) => sum + so.subtotal, 0));
  const deliveryFee = calculateDeliveryFee(itemsTotal);
  return { shopOrders, deliveryFee, totalAmount: round2(itemsTotal + deliveryFee) };
};

const populateForOwners = (order: OrderDocument) =>
  order.populate([
    { path: "shopOrders.shopOrderItems.item", select: "name image price" },
    { path: "shopOrders.shop", select: "name" },
    { path: "shopOrders.owner", select: "fullName" },
    { path: "user", select: "fullName email mobile" },
  ]);

/** Tells each shop owner about a confirmed (COD placed or online paid) order. */
const announceNewOrder = async (order: OrderDocument) => {
  await populateForOwners(order);
  for (const shopOrder of order.shopOrders) {
    const ownerId = id((shopOrder.owner as unknown as { _id: Types.ObjectId })._id);
    emitToUser(ownerId, "newOrder", {
      _id: order._id,
      paymentMethod: order.paymentMethod,
      user: order.user,
      shopOrders: shopOrder,
      createdAt: order.createdAt,
      deliveryAddress: order.deliveryAddress,
      payment: order.payment,
    });
    await notify({
      userId: ownerId,
      type: "order_placed",
      title: "New order received",
      message: `You have a new order worth ₹${shopOrder.subtotal}.`,
      orderId: order._id,
      shopOrderId: shopOrder._id,
    });
  }
};

export type PlaceOrderResult =
  | { kind: "cod"; order: OrderDocument }
  | { kind: "online"; orderId: Types.ObjectId; razorOrder: { id: string; amount: number; currency: string } };

const toResult = async (order: OrderDocument): Promise<PlaceOrderResult> => {
  if (order.paymentMethod === "online") {
    return {
      kind: "online",
      orderId: order._id,
      razorOrder: { id: order.razorpayOrderId ?? "", amount: Math.round(order.totalAmount * 100), currency: "INR" },
    };
  }
  await populateForOwners(order);
  return { kind: "cod", order };
};

export const placeOrder = async (userId: string, input: PlaceOrderInput): Promise<PlaceOrderResult> => {
  // Replaying the same submission returns the original order instead of creating a duplicate.
  if (input.idempotencyKey) {
    const existing = await Order.findOne({ user: userId, idempotencyKey: input.idempotencyKey });
    if (existing) return toResult(existing);
  }

  const { shopOrders, deliveryFee, totalAmount } = await priceCart(input.cartItems);

  let razorpayOrderId: string | undefined;
  if (input.paymentMethod === "online") {
    try {
      const razorOrder = await getRazorpay().orders.create({
        amount: Math.round(totalAmount * 100),
        currency: "INR",
        receipt: `rcpt_${Date.now()}`,
      });
      razorpayOrderId = razorOrder.id;
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error("Razorpay order creation failed:", error);
      throw new AppError(502, "Could not start the payment. Please try again.", "PAYMENT_PROVIDER_ERROR");
    }
  }

  let order: OrderDocument;
  try {
    order = await Order.create({
      user: userId,
      paymentMethod: input.paymentMethod,
      deliveryAddress: {
        ...input.deliveryAddress,
        // GeoJSON is [longitude, latitude]; legacy latitude/longitude fields stay for existing readers.
        location: toGeoJsonPoint(input.deliveryAddress.latitude, input.deliveryAddress.longitude),
      },
      totalAmount,
      deliveryFee,
      shopOrders,
      payment: false,
      razorpayOrderId,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    if (isDuplicateKey(error) && input.idempotencyKey) {
      const existing = await Order.findOne({ user: userId, idempotencyKey: input.idempotencyKey });
      if (existing) return toResult(existing);
    }
    throw error;
  }

  if (order.paymentMethod === "cod") {
    await announceNewOrder(order);
    return { kind: "cod", order };
  }
  return toResult(order);
};

/* ------------------------------------------------------------------ */
/* Payment verification                                                */
/* ------------------------------------------------------------------ */

export const verifyRazorpaySignature = (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
  secret: string,
): boolean => {
  const expected = createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  return safeEqual(expected, signature);
};

export const verifyPayment = async (userId: string, input: VerifyPaymentInput): Promise<OrderDocument> => {
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new AppError(503, "Online payments are not configured on the server", "RAZORPAY_NOT_CONFIGURED");

  const order = await Order.findOne({ _id: input.orderId, user: userId, paymentMethod: "online" });
  if (!order || !order.razorpayOrderId || order.razorpayOrderId !== input.razorpay_order_id) {
    throw AppError.notFound("Order not found");
  }

  if (!verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature, secret)) {
    throw AppError.badRequest("Payment signature verification failed", "INVALID_SIGNATURE");
  }

  // Idempotent: a repeated verification of the same payment just returns the order.
  if (order.payment) {
    if (order.razorpayPaymentId === input.razorpay_payment_id) return order;
    throw AppError.conflict("This order is already paid", "ALREADY_PAID");
  }

  let payment;
  try {
    payment = await getRazorpay().payments.fetch(input.razorpay_payment_id);
  } catch (error) {
    console.error("Razorpay payment fetch failed:", error);
    throw new AppError(502, "Could not confirm the payment. Please try again.", "PAYMENT_PROVIDER_ERROR");
  }
  if (payment.order_id !== order.razorpayOrderId) {
    throw AppError.badRequest("Payment does not belong to this order", "PAYMENT_ORDER_MISMATCH");
  }
  if (Number(payment.amount) !== Math.round(order.totalAmount * 100)) {
    throw AppError.badRequest("Paid amount does not match the order total", "PAYMENT_AMOUNT_MISMATCH");
  }
  if (payment.status !== "captured") {
    throw AppError.conflict("Payment has not been captured", "PAYMENT_NOT_CAPTURED");
  }

  // Compare-and-set so two concurrent verifications flip the flag exactly once.
  const paid = await Order.findOneAndUpdate(
    { _id: order._id, payment: false },
    { payment: true, razorpayPaymentId: input.razorpay_payment_id, paidAt: new Date() },
    { new: true },
  );
  if (!paid) {
    const current = await Order.findById(order._id);
    if (current?.razorpayPaymentId === input.razorpay_payment_id) return current;
    throw AppError.conflict("This order is already paid", "ALREADY_PAID");
  }

  await announceNewOrder(paid);
  await notify({
    userId,
    type: "payment_confirmed",
    title: "Payment received",
    message: `We received your payment of ₹${paid.totalAmount}.`,
    orderId: paid._id,
  });
  return paid;
};

/* ------------------------------------------------------------------ */
/* Reading orders                                                      */
/* ------------------------------------------------------------------ */

export const getMyOrders = async (userId: string, role: UserRole) => {
  if (role === "user") {
    return Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(MY_ORDERS_LIMIT)
      .populate("shopOrders.shop", "name")
      .populate("shopOrders.owner", "fullName email mobile")
      .populate("shopOrders.shopOrderItems.item", "name image price");
  }
  if (role === "owner") {
    // Unpaid online orders are not real orders yet, so owners do not see them.
    const orders = await Order.find({
      "shopOrders.owner": userId,
      $or: [{ paymentMethod: "cod" }, { payment: true }],
    })
      .sort({ createdAt: -1 })
      .limit(MY_ORDERS_LIMIT)
      .populate("shopOrders.shop", "name")
      .populate("user", "fullName email mobile")
      .populate("shopOrders.shopOrderItems.item", "name image price")
      .populate("shopOrders.assignedDeliveryBoy", "fullName mobile");

    return orders.map((order) => ({
      _id: order._id,
      paymentMethod: order.paymentMethod,
      user: order.user,
      // Only the caller's own shop order is ever returned.
      shopOrders: order.shopOrders.find((so) => id(so.owner) === userId),
      createdAt: order.createdAt,
      deliveryAddress: order.deliveryAddress,
      payment: order.payment,
    }));
  }
  return [];
};

export const getOrderById = async (userId: string, role: UserRole, orderId: string) => {
  const order = await Order.findById(orderId)
    .populate("shopOrders.shop")
    .populate("shopOrders.assignedDeliveryBoy", "fullName mobile location")
    .populate("shopOrders.shopOrderItems.item")
    .lean();
  if (!order) throw AppError.notFound("Order not found");

  const isCustomer = id(order.user) === userId;
  if (isCustomer) return order;

  // Non-customers only see the shop order(s) that concern them.
  const visible = order.shopOrders.filter((so) =>
    role === "owner" ? id(so.owner) === userId : role === "deliveryBoy" ? id(so.assignedDeliveryBoy && (so.assignedDeliveryBoy as { _id?: unknown })._id) === userId : false,
  );
  if (visible.length === 0) throw AppError.notFound("Order not found");
  return { ...order, shopOrders: visible };
};

/* ------------------------------------------------------------------ */
/* Status changes by the shop owner                                    */
/* ------------------------------------------------------------------ */

export const updateOrderStatus = async (
  ownerId: string,
  orderId: string,
  shopId: string,
  { status, prepMinutes }: UpdateOrderStatusInput,
) => {
  const order = await Order.findById(orderId);
  const shopOrder = order?.shopOrders.find((so) => id(so.shop) === shopId && id(so.owner) === ownerId);
  // Same response whether the order is missing or belongs to someone else.
  if (!order || !shopOrder) throw AppError.notFound("Shop order not found");

  if (order.paymentMethod === "online" && !order.payment) {
    throw AppError.conflict("This order has not been paid yet", "ORDER_NOT_PAID");
  }
  assertTransition(shopOrder.status, status);

  const previous = shopOrder.status;
  const now = new Date();
  let readyAt: Date | undefined;
  if (status === "preparing") {
    const shop = await Shop.findById(shopOrder.shop).select("avgPrepMinutes").lean();
    const minutes = prepMinutes ?? shop?.avgPrepMinutes ?? defaultDispatchConfig().defaultPrepMinutes;
    readyAt = new Date(now.getTime() + minutes * 60_000);
  }
  // Compare-and-set on the current status: concurrent updates cannot both win.
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, shopOrders: { $elemMatch: { _id: shopOrder._id, status: previous } } },
    {
      $set: {
        "shopOrders.$.status": status,
        ...(status === "cancelled" && { "shopOrders.$.cancelledAt": now }),
        ...(readyAt && { "shopOrders.$.preparingAt": now, "shopOrders.$.readyAt": readyAt }),
      },
    },
    { new: true },
  );
  if (!updated) throw AppError.conflict("Order status was changed by someone else. Please refresh.", "STALE_STATUS");

  // Dispatch is driven by the durable job queue; nothing here blocks on finding a partner.
  const updatedShopOrder = updated.shopOrders.id(shopOrder._id);
  if (status === "preparing" && readyAt) {
    await enqueueDispatch(order._id, shopOrder._id, readyAt);
  } else if (status === "out of delivery") {
    if (updatedShopOrder?.assignedDeliveryBoy) await markPickedUp(updated, shopOrder._id);
    else await enqueueDispatch(order._id, shopOrder._id, updatedShopOrder?.readyAt ?? now); // reopens an exhausted dispatch
  } else if (status === "cancelled") {
    await cancelDispatch(order._id, shopOrder._id);
  }

  await notifyCustomerOfStatus(updated, shopOrder._id, status);

  const fresh = await Order.findById(order._id)
    .populate("shopOrders.shop", "name")
    .populate("shopOrders.assignedDeliveryBoy", "fullName email mobile");
  const freshShopOrder = fresh?.shopOrders.id(shopOrder._id);
  return {
    shopOrder: freshShopOrder,
    assignedDeliveryBoy: freshShopOrder?.assignedDeliveryBoy,
    // Kept for API compatibility: partners are no longer broadcast to, they receive one ranked offer at a time.
    availableBoys: [] as never[],
    assignment: freshShopOrder?.assignment,
  };
};

const STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  preparing: "Your order is being prepared.",
  "out of delivery": "Your order is out for delivery.",
  cancelled: "Your order was cancelled by the restaurant.",
};

const notifyCustomerOfStatus = async (order: OrderDocument, shopOrderId: Types.ObjectId, status: OrderStatus) => {
  const userId = id(order.user);
  emitToUser(userId, "update-status", {
    orderId: order._id,
    shopId: shopOrderId, // the frontend keys realtime updates by the shop order id
    shopOrderId,
    status,
    userId,
  });
  await notify({
    userId,
    type: "order_status",
    title: `Order ${status}`,
    message: STATUS_MESSAGES[status] ?? `Your order is now ${status}.`,
    orderId: order._id,
    shopOrderId,
  });
};

/* ------------------------------------------------------------------ */
/* Delivery partner workflow (offers are created by the dispatch engine) */
/* ------------------------------------------------------------------ */

/** Pending offers for this partner; the response keeps the shape the delivery UI already uses. */
export const getDeliveryAssignments = (deliveryBoyId: string) => getOffersForPartner(deliveryBoyId);

/** `assignmentId` is the offer id. Accepting is race-free; see dispatch.service. */
export const acceptAssignment = (deliveryBoyId: string, assignmentId: string) => acceptOffer(deliveryBoyId, assignmentId);

export const getCurrentDelivery = async (deliveryBoyId: string) => {
  const assignment = await DeliveryAssignment.findOne({ assignedTo: deliveryBoyId, status: "assigned" })
    .populate("shop", "name")
    .populate("assignedTo", "fullName email mobile location")
    .populate({
      path: "order",
      populate: [
        { path: "user", select: "fullName email location mobile" },
        { path: "shopOrders.shop", select: "name address" },
      ],
    });
  const order = assignment?.order as unknown as OrderDocument | undefined;
  if (!assignment || !order) throw AppError.notFound("No active delivery");

  const shopOrder = order.shopOrders.id(assignment.shopOrderId);
  if (!shopOrder) throw AppError.notFound("Shop order not found");

  const partner = assignment.assignedTo as unknown as { location: { coordinates: number[] } };
  const [lon, lat] = partner.location.coordinates;
  return {
    _id: order._id,
    user: order.user,
    shopOrder,
    deliveryAddress: order.deliveryAddress,
    deliveryBoyLocation: { lat: lat ?? null, lon: lon ?? null },
    customerLocation: { lat: order.deliveryAddress.latitude, lon: order.deliveryAddress.longitude },
  };
};

/** Returns the shop order only if the caller is its assigned delivery partner. */
const loadAssignedShopOrder = async (deliveryBoyId: string, orderId: string, shopOrderId: string) => {
  const order = await Order.findOne({
    _id: orderId,
    shopOrders: { $elemMatch: { _id: shopOrderId, assignedDeliveryBoy: deliveryBoyId } },
  }).select("+shopOrders.deliveryOtp +shopOrders.otpExpires +shopOrders.deliveryOtpAttempts");
  const shopOrder = order?.shopOrders.id(shopOrderId);
  if (!order || !shopOrder) throw AppError.notFound("Order not found");
  if (shopOrder.status !== "out of delivery") {
    throw AppError.conflict("Order is not out for delivery", "INVALID_STATE");
  }
  return { order, shopOrder };
};

export const sendDeliveryOtp = async (deliveryBoyId: string, orderId: string, shopOrderId: string) => {
  const { order, shopOrder } = await loadAssignedShopOrder(deliveryBoyId, orderId, shopOrderId);

  const sentAt = shopOrder.otpExpires ? shopOrder.otpExpires.getTime() - DELIVERY_OTP_TTL_MS : 0;
  if (Date.now() - sentAt < 30_000) throw AppError.tooMany("Please wait before requesting another OTP");

  const customer = await User.findById(order.user).select("email fullName");
  if (!customer) throw AppError.notFound("Customer not found");

  const otp = generateNumericCode(4);
  await Order.updateOne(
    { _id: order._id, "shopOrders._id": shopOrder._id },
    {
      $set: {
        "shopOrders.$.deliveryOtp": sha256(otp),
        "shopOrders.$.otpExpires": new Date(Date.now() + DELIVERY_OTP_TTL_MS),
        "shopOrders.$.deliveryOtpAttempts": 0,
      },
    },
  );
  try {
    await sendDeliveryOtpMail(customer.email, otp);
  } catch (error) {
    // Never leave an OTP that the customer did not receive: invalidate it (only if it is still ours)
    // so nothing unsent can be verified and the partner can retry immediately.
    await Order.updateOne(
      { _id: order._id, shopOrders: { $elemMatch: { _id: shopOrder._id, deliveryOtp: sha256(otp) } } },
      { $set: { "shopOrders.$.deliveryOtp": null, "shopOrders.$.otpExpires": null } },
    );
    throw error;
  }
  return { message: `OTP sent successfully to ${customer.fullName}` };
};

export const verifyDeliveryOtp = async (
  deliveryBoyId: string,
  orderId: string,
  shopOrderId: string,
  otp: string,
) => {
  const { order, shopOrder } = await loadAssignedShopOrder(deliveryBoyId, orderId, shopOrderId);
  const invalid = () => AppError.badRequest("Invalid or expired OTP", "INVALID_OTP");

  if (!shopOrder.deliveryOtp || !shopOrder.otpExpires || shopOrder.otpExpires.getTime() < Date.now()) {
    throw invalid();
  }
  if ((shopOrder.deliveryOtpAttempts ?? 0) >= DELIVERY_OTP_MAX_ATTEMPTS) {
    throw AppError.tooMany("Too many wrong attempts. Request a new OTP.");
  }
  if (!safeEqual(shopOrder.deliveryOtp, sha256(otp))) {
    await Order.updateOne(
      { _id: order._id, "shopOrders._id": shopOrder._id },
      { $inc: { "shopOrders.$.deliveryOtpAttempts": 1 } },
    );
    throw invalid();
  }

  // Single-use: only the request that still sees an unconsumed OTP completes the delivery.
  const delivered = await Order.findOneAndUpdate(
    {
      _id: order._id,
      shopOrders: { $elemMatch: { _id: shopOrder._id, status: "out of delivery", deliveryOtp: shopOrder.deliveryOtp } },
    },
    {
      $set: {
        "shopOrders.$.status": "delivered",
        "shopOrders.$.deliveredAt": new Date(),
        "shopOrders.$.deliveryOtp": null,
        "shopOrders.$.otpExpires": null,
      },
    },
    { new: true },
  );
  if (!delivered) throw invalid();

  await DeliveryAssignment.updateOne(
    { shopOrderId: shopOrder._id, order: order._id, assignedTo: deliveryBoyId },
    { status: "completed" },
  );

  const customerId = id(order.user);
  emitToUser(customerId, "update-status", {
    orderId: order._id,
    shopId: shopOrder._id,
    shopOrderId: shopOrder._id,
    status: "delivered",
    userId: customerId,
  });
  await notify({
    userId: customerId,
    type: "order_delivered",
    title: "Order delivered",
    message: "Your order has been delivered. Enjoy your meal!",
    orderId: order._id,
    shopOrderId: shopOrder._id,
  });
  await notify({
    userId: shopOrder.owner,
    type: "order_delivered",
    title: "Order delivered",
    message: `An order worth ₹${shopOrder.subtotal} was delivered.`,
    orderId: order._id,
    shopOrderId: shopOrder._id,
  });
};

export const getTodayDeliveries = async (deliveryBoyId: string) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const orders = await Order.find({
    shopOrders: {
      $elemMatch: { assignedDeliveryBoy: deliveryBoyId, status: "delivered", deliveredAt: { $gte: startOfDay } },
    },
  })
    .select("shopOrders")
    .lean();

  const perHour = new Map<number, number>();
  for (const order of orders) {
    for (const so of order.shopOrders as IShopOrder[]) {
      if (id(so.assignedDeliveryBoy) === deliveryBoyId && so.status === "delivered" && so.deliveredAt && so.deliveredAt >= startOfDay) {
        const hour = new Date(so.deliveredAt).getHours();
        perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
      }
    }
  }
  return [...perHour.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);
};
