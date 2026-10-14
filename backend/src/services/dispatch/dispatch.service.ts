import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { defaultDispatchConfig, type DispatchConfig } from "../../config/dispatch.js";
import { emitToUser } from "../../events/socket.js";
import DeliveryAssignment from "../../models/deliveryAssignment.model.js";
import DeliveryOffer, { type DeliveryOfferDocument } from "../../models/deliveryOffer.model.js";
import DispatchJob, { type DispatchJobDocument } from "../../models/dispatchJob.model.js";
import Order, { type IEta, type IShopOrder, type OrderDocument } from "../../models/order.model.js";
import Shop from "../../models/shop.model.js";
import User, { type UserRole } from "../../models/user.model.js";
import { AppError } from "../../utils/AppError.js";
import { haversineKm, isValidLonLat, type LonLat } from "../../utils/geoMath.js";
import { notify } from "../notification.service.js";
import { computeEta } from "./eta.service.js";
import { rankCandidates } from "./ranking.service.js";

const id = (v: unknown) => String(v);
const LIVE_STATUSES = ["preparing", "out of delivery"] as const;
const JOB_LEASE_MS = 60_000;
const isDuplicateKey = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === 11000;

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const toLonLat = (lon: unknown, lat: unknown): LonLat | null => {
  const p = [Number(lon), Number(lat)] as const;
  return isValidLonLat(p) ? p : null;
};

/** Pickup = the shop's location when known, otherwise the customer's address as a documented approximation. */
const resolveGeometry = async (order: OrderDocument, shopOrder: IShopOrder) => {
  const shop = await Shop.findById(shopOrder.shop).select("location avgPrepMinutes name").lean();
  const dropoff = toLonLat(order.deliveryAddress.longitude, order.deliveryAddress.latitude);
  const shopPoint = shop?.location?.coordinates ? toLonLat(shop.location.coordinates[0], shop.location.coordinates[1]) : null;
  return { shop, dropoff, pickup: shopPoint ?? dropoff, pickupApproximate: !shopPoint };
};

/* ------------------------------------------------------------------ */
/* Enqueue / cancel (called from the order lifecycle)                  */
/* ------------------------------------------------------------------ */

let kick: (() => void) | null = null;
/** The worker registers itself so a new job is picked up immediately instead of at the next poll. */
export const registerKick = (fn: (() => void) | null) => void (kick = fn);

/**
 * Idempotent: creates the durable dispatch job for a shop order, or reopens an exhausted one.
 * This single upsert is the "outbox": if the process dies right after, the worker still finds the job.
 */
export const enqueueDispatch = async (orderId: unknown, shopOrderId: unknown, readyAt: Date): Promise<void> => {
  const now = new Date();
  const filter = { order: orderId, shopOrderId };
  await DispatchJob.updateOne(
    filter,
    { $setOnInsert: { status: "queued", attempts: 0, nextRunAt: now, readyAt, startedAt: now, windowStartedAt: now, excludedPartners: [], failures: 0 } },
    { upsert: true },
  ).catch((e: unknown) => {
    if (!isDuplicateKey(e)) throw e; // concurrent upsert: the other one created it
  });
  // The owner pressing "out of delivery" gives a fresh chance to an exhausted dispatch.
  await DispatchJob.updateOne({ ...filter, status: "exhausted" }, { status: "queued", attempts: 0, nextRunAt: now, windowStartedAt: now, excludedPartners: [] });
  kick?.();
};

export const releaseAssignmentsForCancelled = async (orderId: unknown, shopOrderId: unknown) => {
  const released = await DeliveryAssignment.findOneAndUpdate(
    { order: orderId, shopOrderId, status: "assigned" },
    { status: "completed" },
  );
  if (released?.assignedTo) emitToUser(id(released.assignedTo), "assignmentCancelled", { orderId: id(orderId), shopOrderId: id(shopOrderId) });
};

/** Stops dispatching a shop order (cancelled): closes the job, live offers and any assignment. */
export const cancelDispatch = async (orderId: unknown, shopOrderId: unknown): Promise<void> => {
  await DispatchJob.updateOne({ order: orderId, shopOrderId, status: { $ne: "cancelled" } }, { status: "cancelled", lockedBy: null, lockedUntil: null });
  const live = await DeliveryOffer.find({ order: orderId, shopOrderId, status: "PENDING" });
  for (const offer of live) {
    const closed = await DeliveryOffer.updateOne({ _id: offer._id, status: "PENDING" }, { status: "CANCELLED", reason: "order_cancelled", respondedAt: new Date() });
    if (closed.modifiedCount === 1) emitToUser(id(offer.partner), "offerExpired", { offerId: id(offer._id), reason: "order_cancelled" });
  }
  await releaseAssignmentsForCancelled(orderId, shopOrderId);
};

/* ------------------------------------------------------------------ */
/* Worker: processing one job                                          */
/* ------------------------------------------------------------------ */

const lockedFilter = (job: DispatchJobDocument, token: string) => ({ _id: job._id, status: "processing", lockedBy: token });

const requeue = (jobFilter: Record<string, unknown>, delayMs: number, excludePartner?: unknown) =>
  DispatchJob.updateOne(jobFilter, {
    $set: { status: "queued", nextRunAt: new Date(Date.now() + delayMs), lockedBy: null, lockedUntil: null },
    ...(excludePartner ? { $addToSet: { excludedPartners: excludePartner } } : {}),
  });

const offerPayload = async (offer: DeliveryOfferDocument, order: OrderDocument, shopOrder: IShopOrder, shopName?: string) => ({
  sentTo: offer.partner,
  assignmentId: offer._id, // legacy name used by the existing delivery UI
  offerId: offer._id,
  orderId: order._id,
  shopName,
  deliveryAddress: order.deliveryAddress,
  items: shopOrder.shopOrderItems,
  subtotal: shopOrder.subtotal,
  expiresAt: offer.expiresAt,
});

const liveShopOrder = (order: OrderDocument | null, shopOrderId: unknown) => {
  const shopOrder = order?.shopOrders.id(shopOrderId as string);
  return shopOrder && (LIVE_STATUSES as readonly string[]).includes(shopOrder.status) ? shopOrder : null;
};

export const processJob = async (job: DispatchJobDocument, token: string, cfg: DispatchConfig = defaultDispatchConfig()): Promise<void> => {
  const mine = lockedFilter(job, token);
  const now = new Date();
  const order = await Order.findById(job.order);
  const shopOrder = liveShopOrder(order, job.shopOrderId);

  if (!order || !shopOrder) {
    await DispatchJob.updateOne(mine, { status: "cancelled", lockedBy: null, lockedUntil: null });
    return;
  }
  if (shopOrder.assignedDeliveryBoy) {
    await DispatchJob.updateOne(mine, { status: "assigned", assignedTo: shopOrder.assignedDeliveryBoy, assignedAt: now, lockedBy: null, lockedUntil: null });
    return;
  }

  // Deal with a leftover offer first: expire it by SERVER time, or wait for it.
  const pending = await DeliveryOffer.findOne({ order: job.order, shopOrderId: job.shopOrderId, status: "PENDING" });
  if (pending) {
    if (pending.expiresAt > now) {
      await DispatchJob.updateOne(mine, { status: "waiting_offer", nextRunAt: pending.expiresAt, lockedBy: null, lockedUntil: null });
      return;
    }
    await expireOffer(pending);
    await DispatchJob.updateOne({ _id: job._id }, { $addToSet: { excludedPartners: pending.partner } });
  }
  const fresh = (await DispatchJob.findById(job._id)) as DispatchJobDocument;

  const searchedTooLong = now.getTime() - (fresh.windowStartedAt ?? fresh.startedAt).getTime() > cfg.maxWaitMs;
  if (fresh.attempts >= cfg.maxAttempts || searchedTooLong) {
    const done = await DispatchJob.updateOne(mine, { status: "exhausted", lockedBy: null, lockedUntil: null });
    if (done.modifiedCount === 1) {
      await notify({
        userId: shopOrder.owner,
        type: "order_status",
        title: "No delivery partner found",
        message: "We could not find a delivery partner yet. Set the order to out for delivery again to retry.",
        orderId: order._id,
        shopOrderId: shopOrder._id,
      });
      emitToUser(id(shopOrder.owner), "dispatchExhausted", { orderId: id(order._id), shopOrderId: id(shopOrder._id) });
    }
    return;
  }
  const attempt = fresh.attempts + 1;

  const { shop, pickup, dropoff } = await resolveGeometry(order, shopOrder);
  if (!pickup || !dropoff) {
    await requeue(mine, cfg.retryDelayMs);
    return;
  }

  const nearby = await User.find({
    role: "deliveryBoy",
    isOnline: true,
    locationUpdatedAt: { $gte: new Date(now.getTime() - cfg.locationMaxAgeMs) },
    location: { $near: { $geometry: { type: "Point", coordinates: [pickup[0], pickup[1]] }, $maxDistance: cfg.maxPickupDistanceKm * 1000 } },
  })
    .select("role isOnline location locationUpdatedAt")
    .limit(cfg.maxCandidates)
    .lean();

  const ids = nearby.map((u) => u._id);
  const [busy, offered] = await Promise.all([
    DeliveryAssignment.find({ assignedTo: { $in: ids }, status: "assigned" }).distinct("assignedTo"),
    DeliveryOffer.find({ partner: { $in: ids }, status: "PENDING" }).distinct("partner"),
  ]);
  const activeCount = new Map<string, number>(busy.map((p) => [id(p), 1]));
  const excluded = new Set<string>([...fresh.excludedPartners.map(id), ...offered.map(id)]);

  const { ranked } = rankCandidates(
    {
      candidates: nearby.map((u) => ({
        id: id(u._id),
        role: u.role,
        isOnline: u.isOnline,
        location: u.location?.coordinates,
        locationUpdatedAt: u.locationUpdatedAt,
        activeDeliveries: activeCount.get(id(u._id)) ?? 0,
      })),
      pickup,
      dropoff,
      readyAt: shopOrder.readyAt ?? new Date(now.getTime() + cfg.defaultPrepMinutes * 60_000),
      now,
      excluded,
    },
    cfg,
  );

  const best = ranked[0];
  if (!best) {
    await requeue(mine, cfg.retryDelayMs);
    return;
  }

  // A worker that lost its lease must not even create an offer.
  if (!(await DispatchJob.exists(mine))) return;

  let offer: DeliveryOfferDocument;
  try {
    offer = await DeliveryOffer.create({
      order: job.order,
      shopOrderId: job.shopOrderId,
      partner: best.partnerId,
      status: "PENDING",
      round: attempt,
      expiresAt: new Date(now.getTime() + cfg.offerTimeoutMs),
      snapshot: {
        score: best.score,
        pickupTravelMinutes: best.reasons.pickupTravelMinutes,
        locationAgeSeconds: best.reasons.locationAgeSeconds,
        partnerArrivalAt: best.eta.partnerArrivalAt,
        deliveryAt: best.eta.deliveryAt,
      },
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    // Another worker already placed an offer for this order, or the partner just got one elsewhere.
    await requeue(mine, 1000);
    return;
  }

  // Only a placed offer counts as an attempt; the lease token makes this a no-op for a stale worker.
  const waiting = await DispatchJob.updateOne(mine, {
    $set: { status: "waiting_offer", nextRunAt: offer.expiresAt, lockedBy: null, lockedUntil: null },
    $inc: { attempts: 1 },
  });
  if (waiting.modifiedCount !== 1) {
    // Lost the lease while creating the offer: withdraw it so nobody can accept an orphan.
    await DeliveryOffer.updateOne({ _id: offer._id, status: "PENDING" }, { status: "CANCELLED", reason: "stale_worker", respondedAt: new Date() });
    return;
  }
  emitToUser(id(best.partnerId), "newAssignment", await offerPayload(offer, order, shopOrder, shop?.name));
};

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

/** PENDING → EXPIRED (compare-and-set) and let dispatch move on to the next candidate. */
const expireOffer = async (offer: DeliveryOfferDocument): Promise<boolean> => {
  const done = await DeliveryOffer.updateOne({ _id: offer._id, status: "PENDING" }, { status: "EXPIRED", reason: "timeout", respondedAt: new Date() });
  if (done.modifiedCount !== 1) return false;
  emitToUser(id(offer.partner), "offerExpired", { offerId: id(offer._id), reason: "timeout" });
  await requeue({ order: offer.order, shopOrderId: offer.shopOrderId, status: "waiting_offer" }, 0, offer.partner);
  return true;
};

export const expireDueOffers = async (now = new Date()): Promise<number> => {
  const due = await DeliveryOffer.find({ status: "PENDING", expiresAt: { $lte: now } }).limit(100);
  let n = 0;
  for (const offer of due) if (await expireOffer(offer)) n++;
  if (n > 0) kick?.();
  return n;
};

/** Pending, unexpired offers for this partner. Also the recovery endpoint after a socket reconnect. */
export const getOffersForPartner = async (partnerId: string) => {
  const offers = await DeliveryOffer.find({ partner: partnerId, status: "PENDING", expiresAt: { $gt: new Date() } });
  const out = [];
  for (const offer of offers) {
    const order = await Order.findById(offer.order);
    const shopOrder = order?.shopOrders.id(offer.shopOrderId);
    if (!order || !shopOrder) continue;
    const shop = await Shop.findById(shopOrder.shop).select("name").lean();
    const p = await offerPayload(offer, order, shopOrder, shop?.name);
    out.push({ ...p, sentTo: undefined });
  }
  return out;
};

export const declineOffer = async (partnerId: string, offerId: string) => {
  const declined = await DeliveryOffer.findOneAndUpdate(
    { _id: offerId, partner: partnerId, status: "PENDING" },
    { status: "DECLINED", reason: "declined_by_partner", respondedAt: new Date() },
    { new: true },
  );
  if (!declined) {
    const existing = await DeliveryOffer.findOne({ _id: offerId, partner: partnerId });
    if (!existing) throw AppError.notFound("Offer not found");
    if (existing.status === "DECLINED") return { status: "DECLINED" as const }; // idempotent
    throw AppError.conflict(`Offer is already ${existing.status.toLowerCase()}`, "OFFER_NOT_PENDING");
  }
  await requeue({ order: declined.order, shopOrderId: declined.shopOrderId, status: "waiting_offer" }, 0, declined.partner);
  kick?.();
  return { status: "DECLINED" as const };
};

/**
 * Accepting is the only way an order gets a delivery partner. It is made race-free WITHOUT transactions:
 *   1. offer PENDING→ACCEPTED, conditional on partner, status and server-side expiry;
 *   2. insert the DeliveryAssignment: partial unique indexes allow one active assignment per shop order
 *      and one per partner, so the database picks a single winner;
 *   3. conditionally stamp the order (still live and unassigned) with the partner.
 * A failure in 2 or 3 undoes the earlier steps; a crash between them is repaired by `reconcileAssignments`.
 */
export const acceptOffer = async (partnerId: string, offerId: string) => {
  const now = new Date();
  const accepted = await DeliveryOffer.findOneAndUpdate(
    { _id: offerId, partner: partnerId, status: "PENDING", expiresAt: { $gt: now } },
    { status: "ACCEPTED", respondedAt: now },
    { new: true },
  );

  if (!accepted) {
    const offer = await DeliveryOffer.findOne({ _id: offerId, partner: partnerId });
    if (!offer) throw AppError.notFound("Offer not found");
    if (offer.status === "ACCEPTED") {
      const existing = await DeliveryAssignment.findOne({ order: offer.order, shopOrderId: offer.shopOrderId, assignedTo: partnerId, status: "assigned" });
      if (existing) return { assignmentId: existing._id, orderId: offer.order }; // idempotent retry
    }
    if (offer.status === "PENDING") {
      await expireOffer(offer); // the expiry job may be late; the clock here is authoritative
      throw AppError.conflict("This offer has expired", "OFFER_EXPIRED");
    }
    throw AppError.conflict(`This offer is no longer available (${offer.status.toLowerCase()})`, "OFFER_NOT_AVAILABLE");
  }

  const order0 = await Order.findById(accepted.order).select("shopOrders.shop shopOrders._id");
  const shopId = order0?.shopOrders.id(accepted.shopOrderId)?.shop;

  const undoOffer = (reason: string) =>
    DeliveryOffer.updateOne({ _id: accepted._id }, { status: "CANCELLED", reason, respondedAt: new Date() });

  let assignment;
  try {
    assignment = await DeliveryAssignment.create({
      order: accepted.order,
      shop: shopId,
      shopOrderId: accepted.shopOrderId,
      assignedTo: partnerId,
      status: "assigned",
      acceptedAt: now,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    await undoOffer("assignment_conflict");
    await requeue({ order: accepted.order, shopOrderId: accepted.shopOrderId, status: "waiting_offer" }, 0, partnerId);
    throw AppError.conflict("This order was taken or you already have an active delivery", "ASSIGNMENT_CONFLICT");
  }

  const stamped = await Order.findOneAndUpdate(
    {
      _id: accepted.order,
      shopOrders: { $elemMatch: { _id: accepted.shopOrderId, status: { $in: LIVE_STATUSES }, assignedDeliveryBoy: null } },
    },
    { $set: { "shopOrders.$.assignedDeliveryBoy": partnerId, "shopOrders.$.assignment": assignment._id } },
    { new: true },
  );
  if (!stamped) {
    await DeliveryAssignment.deleteOne({ _id: assignment._id, status: "assigned" });
    await undoOffer("order_unavailable");
    throw AppError.conflict("This order is no longer available", "ORDER_UNAVAILABLE");
  }

  const closed = await DispatchJob.updateOne(
    { order: accepted.order, shopOrderId: accepted.shopOrderId, status: { $in: ["waiting_offer", "processing", "queued"] } },
    { status: "assigned", assignedTo: partnerId, assignedAt: new Date(), lockedBy: null, lockedUntil: null },
  );
  void closed;

  await afterAssignment(stamped, accepted.shopOrderId, partnerId);
  return { assignmentId: assignment._id, orderId: accepted.order };
};

/** ETA + notifications. Failures here must not undo an assignment that is already durable. */
const afterAssignment = async (order: OrderDocument, shopOrderId: Types.ObjectId, partnerId: string) => {
  try {
    const shopOrder = order.shopOrders.id(shopOrderId);
    if (!shopOrder) return;
    const [partner, geo] = await Promise.all([User.findById(partnerId).select("location").lean(), resolveGeometry(order, shopOrder)]);
    const cfg = defaultDispatchConfig();
    const partnerPoint = partner?.location?.coordinates ? toLonLat(partner.location.coordinates[0], partner.location.coordinates[1]) : null;
    if (geo.pickup && geo.dropoff) {
      const now = new Date();
      const eta = computeEta({ now, readyAt: shopOrder.readyAt ?? now, pickup: geo.pickup, dropoff: geo.dropoff, partner: partnerPoint }, cfg);
      const doc: IEta = {
        predictedAt: now,
        basis: "assignment",
        partnerArrivalAt: eta.partnerArrivalAt,
        pickupAt: eta.pickupAt,
        deliveryAt: eta.deliveryAt,
        basisPoint: partnerPoint ? { type: "Point", coordinates: [partnerPoint[0], partnerPoint[1]] } : null,
      };
      await Order.updateOne(
        { _id: order._id, shopOrders: { $elemMatch: { _id: shopOrderId, etaAtAssignment: null } } },
        { $set: { "shopOrders.$.eta": doc, "shopOrders.$.etaAtAssignment": doc } },
      );
      emitToUser(id(order.user), "etaUpdated", { orderId: id(order._id), shopOrderId: id(shopOrderId), eta: doc });
    }
    emitToUser(id(order.user), "update-status", { orderId: order._id, shopId: shopOrderId, shopOrderId, status: shopOrder.status, userId: id(order.user) });
    await notify({
      userId: order.user,
      type: "delivery_assigned",
      title: "Delivery partner assigned",
      message: "A delivery partner has accepted your order.",
      orderId: order._id,
      shopOrderId,
    });
  } catch (error) {
    console.error("Post-assignment step failed:", error instanceof Error ? error.message : error);
  }
};

/* ------------------------------------------------------------------ */
/* ETA revision                                                        */
/* ------------------------------------------------------------------ */

const ETA_MIN_INTERVAL_MS = 30_000;
const ETA_MIN_MOVE_KM = 0.25;
const ETA_MIN_CHANGE_MS = 60_000;
const lastEta = new Map<string, { at: number; point: LonLat }>();

/** The partner picked the order up (owner marked it out for delivery): only the last leg remains. */
export const markPickedUp = async (order: OrderDocument, shopOrderId: Types.ObjectId): Promise<void> => {
  const shopOrder = order.shopOrders.id(shopOrderId);
  if (!shopOrder?.assignedDeliveryBoy) return;
  const geo = await resolveGeometry(order, shopOrder);
  if (!geo.pickup || !geo.dropoff) return;
  const now = new Date();
  const eta = computeEta({ now, readyAt: now, pickup: geo.pickup, dropoff: geo.dropoff, pickedUp: true }, defaultDispatchConfig());
  const doc: IEta = { predictedAt: now, basis: "pickup", partnerArrivalAt: null, pickupAt: eta.pickupAt, deliveryAt: eta.deliveryAt, basisPoint: null };
  await Order.updateOne(
    { _id: order._id, shopOrders: { $elemMatch: { _id: shopOrderId } } },
    { $set: { "shopOrders.$.eta": doc, "shopOrders.$.pickedUpAt": now } },
  );
  emitToUser(id(order.user), "etaUpdated", { orderId: id(order._id), shopOrderId: id(shopOrderId), eta: doc });
};

/**
 * Called on every partner GPS update, so it is throttled in memory (≥30 s and ≥250 m since the last
 * revision) and again before writing (only if the estimate moved by ≥1 min).
 */
export const refreshEtaOnPartnerMove = async (partnerId: string, point: LonLat, now = new Date()): Promise<boolean> => {
  const last = lastEta.get(partnerId);
  if (last && (now.getTime() - last.at < ETA_MIN_INTERVAL_MS || haversineKm(last.point, point) < ETA_MIN_MOVE_KM)) return false;
  lastEta.set(partnerId, { at: now.getTime(), point });

  const assignment = await DeliveryAssignment.findOne({ assignedTo: partnerId, status: "assigned" }).select("order shopOrderId").lean();
  if (!assignment) return false;
  const order = await Order.findById(assignment.order);
  const shopOrder = order?.shopOrders.id(assignment.shopOrderId);
  if (!order || !shopOrder || !(LIVE_STATUSES as readonly string[]).includes(shopOrder.status)) return false;

  const geo = await resolveGeometry(order, shopOrder);
  if (!geo.pickup || !geo.dropoff) return false;
  const pickedUp = Boolean(shopOrder.pickedUpAt);
  const eta = computeEta(
    { now, readyAt: shopOrder.readyAt ?? now, pickup: geo.pickup, dropoff: geo.dropoff, partner: pickedUp ? undefined : point, pickedUp },
    defaultDispatchConfig(),
  );
  // After pickup the leg is measured from the partner's current position, not the restaurant.
  const deliveryAt = pickedUp
    ? computeEta({ now, readyAt: now, pickup: point, dropoff: geo.dropoff, pickedUp: true }, defaultDispatchConfig()).deliveryAt
    : eta.deliveryAt;
  if (shopOrder.eta && Math.abs(shopOrder.eta.deliveryAt.getTime() - deliveryAt.getTime()) < ETA_MIN_CHANGE_MS) return false;

  const doc: IEta = {
    predictedAt: now,
    basis: "partner_moved",
    partnerArrivalAt: eta.partnerArrivalAt,
    pickupAt: eta.pickupAt,
    deliveryAt,
    basisPoint: { type: "Point", coordinates: [point[0], point[1]] },
  };
  await Order.updateOne({ _id: order._id, shopOrders: { $elemMatch: { _id: shopOrder._id } } }, { $set: { "shopOrders.$.eta": doc } });
  emitToUser(id(order.user), "etaUpdated", { orderId: id(order._id), shopOrderId: id(shopOrder._id), eta: doc });
  return true;
};

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

/**
 * Repairs the window between "assignment inserted" and "order stamped", and re-creates jobs that were never
 * written (e.g. orders already in preparing when this feature was deployed, or a crash before the upsert).
 */
export const recoverState = async (now = new Date(), limit = 100): Promise<{ repaired: number; enqueued: number }> => {
  let repaired = 0;
  const staleAssignments = await DeliveryAssignment.find({ status: "assigned", updatedAt: { $lt: new Date(now.getTime() - 30_000) } }).limit(limit);
  for (const a of staleAssignments) {
    const order = await Order.findById(a.order);
    const so = order?.shopOrders.id(a.shopOrderId);
    if (!order || !so) continue;
    if (so.status === "delivered" || so.status === "cancelled") {
      await DeliveryAssignment.updateOne({ _id: a._id, status: "assigned" }, { status: "completed" });
      repaired++;
    } else if (!so.assignedDeliveryBoy) {
      const fixed = await Order.updateOne(
        { _id: a.order, shopOrders: { $elemMatch: { _id: a.shopOrderId, assignedDeliveryBoy: null } } },
        { $set: { "shopOrders.$.assignedDeliveryBoy": a.assignedTo, "shopOrders.$.assignment": a._id } },
      );
      if (fixed.modifiedCount === 1) repaired++;
    }
  }

  let enqueued = 0;
  const orphans = await Order.find({
    shopOrders: { $elemMatch: { status: { $in: LIVE_STATUSES }, assignedDeliveryBoy: null } },
    $or: [{ paymentMethod: "cod" }, { payment: true }],
  })
    .select("shopOrders")
    .limit(limit)
    .lean();
  for (const o of orphans) {
    for (const so of o.shopOrders) {
      if (!(LIVE_STATUSES as readonly string[]).includes(so.status) || so.assignedDeliveryBoy) continue;
      if (await DispatchJob.exists({ order: o._id, shopOrderId: so._id })) continue;
      await enqueueDispatch(o._id, so._id, so.readyAt ?? now);
      enqueued++;
    }
  }
  return { repaired, enqueued };
};

/* ------------------------------------------------------------------ */
/* Worker tick                                                         */
/* ------------------------------------------------------------------ */

export const workerId = () => `${process.pid}-${randomUUID().slice(0, 8)}`;

const claimNextJob = (token: string, now: Date) =>
  DispatchJob.findOneAndUpdate(
    {
      $or: [
        { status: { $in: ["queued", "waiting_offer"] }, nextRunAt: { $lte: now } },
        // A worker that died mid-job: its lease expired, so anyone may take over.
        { status: "processing", lockedUntil: { $lt: now } },
      ],
    },
    { $set: { status: "processing", lockedBy: token, lockedUntil: new Date(now.getTime() + JOB_LEASE_MS) } },
    { sort: { nextRunAt: 1 }, new: true },
  );

/** Upper bound of jobs one pass may claim per lane, so a pass always ends and expiry/recovery keep running (backpressure). */
const MAX_JOBS_PER_LANE_PER_PASS = 25;

export const runDispatchTick = async (cfg: DispatchConfig = defaultDispatchConfig(), concurrency = 5): Promise<number> => {
  await expireDueOffers();
  let processed = 0;
  const lane = async () => {
    for (let claimed = 0; claimed < MAX_JOBS_PER_LANE_PER_PASS; claimed++) {
      const token = workerId();
      const job = await claimNextJob(token, new Date());
      if (!job) return;
      processed++;
      try {
        await processJob(job, token, cfg);
      } catch (error) {
        const code = error instanceof Error ? error.name : "ERROR";
        console.error(`Dispatch job failed (${code})`);
        // Retry later; the lease token guards against overwriting a newer owner.
        await DispatchJob.updateOne(
          { _id: job._id, status: "processing", lockedBy: token },
          { $set: { status: "queued", nextRunAt: new Date(Date.now() + cfg.retryDelayMs), lockedBy: null, lockedUntil: null, lastError: code }, $inc: { failures: 1 } },
        );
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  return processed;
};

/* ------------------------------------------------------------------ */
/* Status for authorised viewers                                       */
/* ------------------------------------------------------------------ */

export const getDispatchStatus = async (viewerId: string, role: UserRole, orderId: string, shopOrderId: string) => {
  const order = await Order.findById(orderId).lean();
  const so = order?.shopOrders.find((s) => id(s._id) === shopOrderId);
  const allowed = order && so && (role === "admin" || id(order.user) === viewerId || id(so.owner) === viewerId);
  if (!order || !so || !allowed) throw AppError.notFound("Order not found");

  const cfg = defaultDispatchConfig();
  const job = await DispatchJob.findOne({ order: orderId, shopOrderId }).lean();
  return {
    dispatch: job
      ? { status: job.status, attempts: job.attempts, maxAttempts: cfg.maxAttempts, startedAt: job.startedAt, assignedAt: job.assignedAt ?? null }
      : { status: "not_started" as const },
    assigned: Boolean(so.assignedDeliveryBoy),
    orderStatus: so.status,
    readyAt: so.readyAt ?? null,
    eta: so.eta ?? null,
    etaNote: "Estimates assume an average speed and are not guaranteed arrival times.",
  };
};
