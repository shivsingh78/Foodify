import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const razorpay = vi.hoisted(() => ({
  create: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../src/config/razorpay.js", () => ({
  getRazorpay: () => ({ orders: { create: razorpay.create }, payments: { fetch: razorpay.fetch } }),
}));
vi.mock("../src/utils/mail.js", () => ({
  sendOtpMail: vi.fn(async () => undefined),
  sendDeliveryOtpMail: vi.fn(async () => undefined),
}));

import Order from "../src/models/order.model.js";
import { sha256 } from "../src/utils/crypto.js";
import { calculateDeliveryFee } from "../src/services/pricing.js";
import { assertTransition, canTransition } from "../src/services/orderStateMachine.js";
import { runDispatchTick } from "../src/services/dispatch/dispatch.service.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();

const place = (cookie: string, body: Record<string, unknown>) =>
  request(app).post("/api/order/place-order").set("Cookie", cookie).send(body);

beforeEach(() => {
  razorpay.create.mockReset();
  razorpay.fetch.mockReset();
});

describe("order state machine", () => {
  it("allows only the documented transitions", () => {
    expect(canTransition("pending", "preparing")).toBe(true);
    expect(canTransition("preparing", "out of delivery")).toBe(true);
    expect(canTransition("pending", "out of delivery")).toBe(false);
    expect(canTransition("pending", "delivered")).toBe(false);
    expect(canTransition("delivered", "pending")).toBe(false);
    expect(canTransition("cancelled", "preparing")).toBe(false);
    expect(() => assertTransition("out of delivery", "cancelled")).toThrow();
  });
});

describe("pricing", () => {
  it("charges delivery below the threshold only", () => {
    expect(calculateDeliveryFee(500)).toBe(40);
    expect(calculateDeliveryFee(501)).toBe(0);
  });
});

describe("placing orders", () => {
  it("calculates totals on the server from database prices", async () => {
    const { items } = await setupShop();
    const customer = await createUserWithRole("user");
    const res = await place(customer.cookie, {
      paymentMethod: "cod",
      deliveryAddress: address,
      cartItems: [
        { id: String(items[0]?._id), quantity: 3 }, // 3 x 200
        { id: String(items[1]?._id), quantity: 1 }, // 1 x 100
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.totalAmount).toBe(700); // 700 items, free delivery above 500
    expect(res.body.deliveryFee).toBe(0);
  });

  it("applies the delivery fee rule server-side", async () => {
    const { items } = await setupShop();
    const customer = await createUserWithRole("user");
    const res = await place(customer.cookie, {
      paymentMethod: "cod",
      deliveryAddress: address,
      cartItems: [{ id: String(items[1]?._id), quantity: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.totalAmount).toBe(140);
    expect(res.body.deliveryFee).toBe(40);
  });

  it("rejects client-supplied prices and totals", async () => {
    const { items } = await setupShop();
    const customer = await createUserWithRole("user");
    const withTotal = await place(customer.cookie, {
      paymentMethod: "cod",
      deliveryAddress: address,
      totalAmount: 1,
      cartItems: [{ id: String(items[0]?._id), quantity: 1 }],
    });
    expect(withTotal.status).toBe(400);
    const withPrice = await place(customer.cookie, {
      paymentMethod: "cod",
      deliveryAddress: address,
      cartItems: [{ id: String(items[0]?._id), quantity: 1, price: 1 }],
    });
    expect(withPrice.status).toBe(400);
  });

  it("refuses unavailable and unknown items", async () => {
    const { items } = await setupShop("Pune", [{ name: "Sold out", price: 50, isAvailable: false }]);
    const customer = await createUserWithRole("user");
    const unavailable = await place(customer.cookie, {
      paymentMethod: "cod",
      deliveryAddress: address,
      cartItems: [{ id: String(items[0]?._id), quantity: 1 }],
    });
    expect(unavailable.status).toBe(409);
    const unknown = await place(customer.cookie, {
      paymentMethod: "cod",
      deliveryAddress: address,
      cartItems: [{ id: String(new mongoose.Types.ObjectId()), quantity: 1 }],
    });
    expect(unknown.status).toBe(400);
  });

  it("is idempotent for a repeated submission", async () => {
    const { items } = await setupShop();
    const customer = await createUserWithRole("user");
    const body = {
      paymentMethod: "cod",
      deliveryAddress: address,
      idempotencyKey: "same-key-12345",
      cartItems: [{ id: String(items[0]?._id), quantity: 1 }],
    };
    const [a, b] = await Promise.all([place(customer.cookie, body), place(customer.cookie, body)]);
    expect([a.status, b.status].every((s) => s === 201)).toBe(true);
    expect(a.body._id).toBe(b.body._id);
    expect(await Order.countDocuments({})).toBe(1);
  });

  it("does not let owners or delivery partners place orders", async () => {
    const { items, owner } = await setupShop();
    const res = await place(owner.cookie, {
      paymentMethod: "cod",
      deliveryAddress: address,
      cartItems: [{ id: String(items[0]?._id), quantity: 1 }],
    });
    expect(res.status).toBe(403);
  });
});

describe("payment verification", () => {
  const placeOnline = async () => {
    const shop = await setupShop();
    const customer = await createUserWithRole("user");
    razorpay.create.mockResolvedValue({ id: "order_RZP1" });
    const res = await place(customer.cookie, {
      paymentMethod: "online",
      deliveryAddress: address,
      cartItems: [{ id: String(shop.items[0]?._id), quantity: 1 }],
    });
    return { ...shop, customer, orderId: res.body.orderId as string, res };
  };
  const sign = (orderId: string, paymentId: string) =>
    createHmac("sha256", "razorpay-test-secret").update(`${orderId}|${paymentId}`).digest("hex");
  const verify = (cookie: string, orderId: string, over: Record<string, string> = {}) =>
    request(app)
      .post("/api/order/verify-payment")
      .set("Cookie", cookie)
      .send({
        orderId,
        razorpay_order_id: "order_RZP1",
        razorpay_payment_id: "pay_1",
        razorpay_signature: sign("order_RZP1", "pay_1"),
        ...over,
      });

  it("creates the provider order for the server-computed amount", async () => {
    const { res } = await placeOnline();
    expect(res.status).toBe(200);
    expect(razorpay.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 24000, currency: "INR" })); // 200 + 40 fee
  });

  it("rejects an invalid signature", async () => {
    const { customer, orderId } = await placeOnline();
    const res = await verify(customer.cookie, orderId, { razorpay_signature: "deadbeef" });
    expect(res.status).toBe(400);
    expect((await Order.findById(orderId))?.payment).toBe(false);
  });

  it("rejects a mismatched amount even with a valid signature", async () => {
    const { customer, orderId } = await placeOnline();
    razorpay.fetch.mockResolvedValue({ order_id: "order_RZP1", amount: 100, status: "captured" });
    const res = await verify(customer.cookie, orderId);
    expect(res.status).toBe(400);
    expect((await Order.findById(orderId))?.payment).toBe(false);
  });

  it("rejects a payment that is not captured", async () => {
    const { customer, orderId } = await placeOnline();
    razorpay.fetch.mockResolvedValue({ order_id: "order_RZP1", amount: 24000, status: "failed" });
    expect((await verify(customer.cookie, orderId)).status).toBe(409);
    expect((await Order.findById(orderId))?.payment).toBe(false);
  });

  it("marks the order paid once, and repeats are idempotent", async () => {
    const { customer, orderId } = await placeOnline();
    razorpay.fetch.mockResolvedValue({ order_id: "order_RZP1", amount: 24000, status: "captured" });
    const [a, b] = await Promise.all([verify(customer.cookie, orderId), verify(customer.cookie, orderId)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const order = await Order.findById(orderId);
    expect(order?.payment).toBe(true);
    expect(order?.razorpayPaymentId).toBe("pay_1");
  });

  it("does not let another customer verify someone else's order", async () => {
    const { orderId } = await placeOnline();
    const other = await createUserWithRole("user");
    razorpay.fetch.mockResolvedValue({ order_id: "order_RZP1", amount: 24000, status: "captured" });
    expect((await verify(other.cookie, orderId)).status).toBe(404);
  });

  it("hides unpaid online orders from the shop owner until payment", async () => {
    const { owner, customer, orderId } = await placeOnline();
    const before = await request(app).get("/api/order/my-orders").set("Cookie", owner.cookie);
    expect(before.body).toHaveLength(0);
    razorpay.fetch.mockResolvedValue({ order_id: "order_RZP1", amount: 24000, status: "captured" });
    await verify(customer.cookie, orderId);
    const after = await request(app).get("/api/order/my-orders").set("Cookie", owner.cookie);
    expect(after.body).toHaveLength(1);
  });
});

describe("order authorization and lifecycle", () => {
  const placeCod = async () => {
    const shop = await setupShop();
    const customer = await createUserWithRole("user");
    const res = await place(customer.cookie, {
      paymentMethod: "cod",
      deliveryAddress: address,
      cartItems: [{ id: String(shop.items[0]?._id), quantity: 1 }],
    });
    return { ...shop, customer, order: res.body };
  };
  const setStatus = (cookie: string, orderId: string, shopId: string, status: string) =>
    request(app).post(`/api/order/update-status/${orderId}/${shopId}`).set("Cookie", cookie).send({ status });

  it("blocks customers from reading other customers' orders", async () => {
    const { order } = await placeCod();
    const stranger = await createUserWithRole("user");
    expect((await request(app).get(`/api/order/get-order-by-id/${order._id}`).set("Cookie", stranger.cookie)).status).toBe(404);
  });

  it("lets the customer and the owning shop read the order, and not another shop", async () => {
    const { order, customer, owner } = await placeCod();
    expect((await request(app).get(`/api/order/get-order-by-id/${order._id}`).set("Cookie", customer.cookie)).status).toBe(200);
    expect((await request(app).get(`/api/order/get-order-by-id/${order._id}`).set("Cookie", owner.cookie)).status).toBe(200);
    const otherOwner = await createUserWithRole("owner");
    expect((await request(app).get(`/api/order/get-order-by-id/${order._id}`).set("Cookie", otherOwner.cookie)).status).toBe(404);
  });

  it("never returns password hashes or OTP hashes in order payloads", async () => {
    const { order, customer } = await placeCod();
    const res = await request(app).get(`/api/order/get-order-by-id/${order._id}`).set("Cookie", customer.cookie);
    expect(JSON.stringify(res.body)).not.toMatch(/password|deliveryOtp/);
  });

  it("only the owning shop can change status, and only along valid transitions", async () => {
    const { order, shop, owner } = await placeCod();
    const otherOwner = await createUserWithRole("owner");
    expect((await setStatus(otherOwner.cookie, order._id, String(shop._id), "preparing")).status).toBe(404);

    expect((await setStatus(owner.cookie, order._id, String(shop._id), "out of delivery")).status).toBe(409);
    expect((await setStatus(owner.cookie, order._id, String(shop._id), "preparing")).status).toBe(200);
    expect((await setStatus(owner.cookie, order._id, String(shop._id), "preparing")).status).toBe(409);
    expect((await setStatus(owner.cookie, order._id, String(shop._id), "delivered")).status).toBe(400);
  });

  it("customers cannot change order status", async () => {
    const { order, shop, customer } = await placeCod();
    expect((await setStatus(customer.cookie, order._id, String(shop._id), "preparing")).status).toBe(403);
  });

  it("supports cancellation from pending and blocks further transitions", async () => {
    const { order, shop, owner } = await placeCod();
    expect((await setStatus(owner.cookie, order._id, String(shop._id), "cancelled")).status).toBe(200);
    expect((await setStatus(owner.cookie, order._id, String(shop._id), "preparing")).status).toBe(409);
  });

  it("completes delivery only through the assigned partner's OTP", async () => {
    const { order, shop, owner, customer } = await placeCod();
    const boy = await createUserWithRole("deliveryBoy");
    const otherBoy = await createUserWithRole("deliveryBoy");
    await mongoose.model("User").updateMany(
      { _id: { $in: [boy.user._id, otherBoy.user._id] } },
      { location: { type: "Point", coordinates: [address.longitude, address.latitude] }, isOnline: true, locationUpdatedAt: new Date() },
    );

    // Dispatch starts when the owner begins preparing; the engine offers the order to ONE ranked partner.
    expect((await setStatus(owner.cookie, order._id, String(shop._id), "preparing")).status).toBe(200);
    await runDispatchTick();
    const offers = await Promise.all([boy, otherBoy].map((b) => request(app).get("/api/order/get-assignments").set("Cookie", b.cookie)));
    expect(offers.map((r) => r.body.length).sort()).toEqual([0, 1]);
    const winner = offers[0]?.body.length ? boy : otherBoy;
    const loser = winner === boy ? otherBoy : boy;
    const assignmentId = offers.find((r) => r.body.length)?.body[0].assignmentId as string;

    // A partner who was not offered the order cannot take it.
    expect((await request(app).post(`/api/order/accept-order/${assignmentId}`).set("Cookie", loser.cookie)).status).toBe(404);
    expect((await request(app).post(`/api/order/accept-order/${assignmentId}`).set("Cookie", winner.cookie)).status).toBe(200);

    const out = await setStatus(owner.cookie, order._id, String(shop._id), "out of delivery");
    expect(out.status).toBe(200);
    const shopOrderId = out.body.shopOrder._id as string;
    const send = (c: string) =>
      request(app).post("/api/order/send-delivery-otp").set("Cookie", c).send({ orderId: order._id, shopOrderId });
    expect((await send(loser.cookie)).status).toBe(404);
    expect((await send(customer.cookie)).status).toBe(403);
    expect((await send(winner.cookie)).status).toBe(200);

    const verify = (c: string, otp: string) =>
      request(app).post("/api/order/verify-delivery-otp").set("Cookie", c).send({ orderId: order._id, shopOrderId, otp });
    expect((await verify(winner.cookie, "0000")).status).toBe(400);

    await Order.updateOne(
      { _id: order._id, "shopOrders._id": shopOrderId },
      { $set: { "shopOrders.$.deliveryOtp": sha256("4321") } },
    );
    expect((await verify(loser.cookie, "4321")).status).toBe(404);
    expect((await verify(winner.cookie, "4321")).status).toBe(200);
    expect((await verify(winner.cookie, "4321")).status).toBe(409); // single use
    const delivered = await Order.findById(order._id);
    expect(delivered?.shopOrders[0]?.status).toBe("delivered");
  });
});
