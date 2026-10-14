import { Types } from "mongoose";
import { emitToUser } from "../events/socket.js";
import Order from "../models/order.model.js";
import Shop from "../models/shop.model.js";
import { notify } from "./notification.service.js";

const id = (v: unknown) => String(v);
const MAX_ATTEMPTS = 10;
const backoffMs = (attempt: number) => Math.min(5_000 * 2 ** (attempt - 1), 5 * 60_000);

/**
 * Delivers the "order ready for pickup" notice to the assigned partner. Safe to call any number of times, from
 * any number of instances, at any point after a crash:
 *  - the attempt is claimed with a conditional update (and pushed back by a backoff), so only one caller proceeds;
 *  - the notification is persisted with a dedupe key, so it exists exactly once;
 *  - the intent is marked done only after persistence, so a crash before that is retried;
 *  - the live event is sent only by the call that actually created the notification, and only to that partner.
 * Socket.IO is best effort: a missed event is covered by the persisted notification and the dashboard's refetches.
 */
export const deliverPickupNotice = async (orderId: unknown, shopOrderId: unknown, now = new Date()): Promise<"delivered" | "skipped" | "retry" | "busy"> => {
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, shopOrders: { $elemMatch: { _id: shopOrderId, pickupNoticeStatus: "pending", pickupNoticeNextAt: { $lte: now } } } },
    { $inc: { "shopOrders.$.pickupNoticeAttempts": 1 } },
    { new: true },
  );
  const so = claimed?.shopOrders.id(shopOrderId as string);
  if (!claimed || !so) return "busy"; // done already, or another worker holds this attempt
  const attempt = so.pickupNoticeAttempts ?? 1;
  const mark = (state: "done" | "failed") =>
    Order.updateOne({ _id: claimed._id, shopOrders: { $elemMatch: { _id: so._id, pickupNoticeStatus: "pending" } } }, { $set: { "shopOrders.$.pickupNoticeStatus": state } });
  const later = (ms: number) =>
    Order.updateOne({ _id: claimed._id, "shopOrders._id": so._id }, { $set: { "shopOrders.$.pickupNoticeNextAt": new Date(now.getTime() + ms) } });

  // The partner is resolved from authoritative state, not from when the intent was written.
  const partnerId = so.assignedDeliveryBoy;
  if (so.status !== "out of delivery" || !partnerId) {
    await mark("done"); // nobody to tell (no partner yet, or the order already moved on)
    return "skipped";
  }

  const shop = await Shop.findById(so.shop).select("name").lean();
  const result = await notify({
    userId: partnerId,
    type: "order_status",
    title: "Order ready for pickup",
    message: `${shop?.name ?? "The restaurant"} has marked the order out for delivery. It is ready for you.`,
    orderId: claimed._id as Types.ObjectId,
    shopOrderId: so._id,
    dedupeKey: `ready-for-pickup:${id(claimed._id)}:${id(so._id)}`,
  });
  if (result === "failed") {
    if (attempt >= MAX_ATTEMPTS) {
      await mark("failed");
      console.error(JSON.stringify({ component: "pickup-notice", event: "given_up", orderId: id(claimed._id), shopOrderId: id(so._id), attempts: attempt }));
    } else await later(backoffMs(attempt));
    return "retry";
  }
  await mark("done");
  if (result === "created") {
    try {
      emitToUser(id(partnerId), "deliveryReadyForPickup", { orderId: id(claimed._id), shopOrderId: id(so._id), shopName: shop?.name ?? null, status: "out of delivery" });
    } catch (error) {
      console.error("pickup event failed:", error instanceof Error ? error.message : error);
    }
  }
  return "delivered";
};

/**
 * Finds intents that were never delivered (crash, restart, transient failure) and delivers them. Run by the
 * dispatch worker; the first attempt of a fresh intent is made inline, so this only picks up stragglers.
 */
export const recoverPickupNotices = async (now = new Date(), limit = 50): Promise<number> => {
  const due = await Order.find({ shopOrders: { $elemMatch: { pickupNoticeStatus: "pending", pickupNoticeNextAt: { $lte: now } } } })
    .select("shopOrders._id shopOrders.pickupNoticeStatus shopOrders.pickupNoticeNextAt")
    .limit(limit)
    .lean();
  let delivered = 0;
  for (const order of due) {
    for (const so of order.shopOrders) {
      if (so.pickupNoticeStatus !== "pending" || !so.pickupNoticeNextAt || so.pickupNoticeNextAt > now) continue;
      if ((await deliverPickupNotice(order._id, so._id, now)) === "delivered") delivered++;
    }
  }
  return delivered;
};
