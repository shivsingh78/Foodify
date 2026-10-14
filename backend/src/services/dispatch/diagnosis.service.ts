import { Types } from "mongoose";
import { defaultDispatchConfig } from "../../config/dispatch.js";
import DeliveryAssignment from "../../models/deliveryAssignment.model.js";
import DeliveryOffer from "../../models/deliveryOffer.model.js";
import DispatchJob from "../../models/dispatchJob.model.js";
import Order from "../../models/order.model.js";
import User from "../../models/user.model.js";
import { AppError } from "../../utils/AppError.js";
import { haversineKm, isValidLonLat } from "../../utils/geoMath.js";
import { resolveGeometry } from "./dispatch.service.js";
import { partnerDistanceLimitKm, rankCandidates } from "./ranking.service.js";
import { dispatchWorkerState, geoIndexPresent } from "./worker.js";

/**
 * Read-only, stage-by-stage explanation of why a live, unassigned shop order has (or has not) been offered to a
 * delivery partner, computed from the live database with the SAME eligibility rules as the worker. It does not use
 * `$near`, so it still works when the geo index is missing (and reports that). Owners see counts only; admins also
 * see per-partner reasons (ids, rounded distance and location age; never coordinates or contact details).
 */
const id = (v: unknown) => String(v);
const round1 = (n: number) => Math.round(n * 10) / 10;
const MAX_PARTNERS = 500;

export const diagnoseDispatch = async (viewerId: string, role: "owner" | "admin", now = new Date()) => {
  const cfg = defaultDispatchConfig();
  const live = { status: { $in: ["preparing", "out of delivery"] }, assignedDeliveryBoy: null };
  const orders = await Order.find({ shopOrders: { $elemMatch: role === "admin" ? live : { ...live, owner: new Types.ObjectId(viewerId) } } })
    .sort({ createdAt: -1 })
    .limit(role === "admin" ? 10 : 5);

  const partners = await User.find({ role: "deliveryBoy" }).select("isOnline location locationUpdatedAt deliveryProfile.serviceArea").limit(MAX_PARTNERS).lean();
  const partnerIds = partners.map((p) => p._id);
  const [busy, pending] = await Promise.all([
    DeliveryAssignment.find({ assignedTo: { $in: partnerIds }, status: "assigned" }).select("assignedTo shopOrderId").lean(),
    DeliveryOffer.find({ partner: { $in: partnerIds }, status: "PENDING" }).select("partner shopOrderId expiresAt").lean(),
  ]);
  const busyIds = new Map(busy.map((a) => [id(a.assignedTo), id(a.shopOrderId)]));

  const report = [];
  for (const order of orders) {
    for (const so of order.shopOrders) {
      if (!["preparing", "out of delivery"].includes(so.status) || so.assignedDeliveryBoy) continue;
      if (role === "owner" && id(so.owner) !== viewerId) continue;

      const job = await DispatchJob.findOne({ order: order._id, shopOrderId: so._id }).lean();
      const liveOffer = pending.find((o) => id(o.shopOrderId) === id(so._id));
      const geo = await resolveGeometry(order, so);
      const excluded = new Set((job?.excludedPartners ?? []).map(id));
      const pendingElsewhere = new Set(pending.filter((o) => id(o.shopOrderId) !== id(so._id)).map((o) => id(o.partner)));

      const perPartner: { partnerId: string; result: string; distanceKm: number | null; locationAgeSeconds: number | null }[] = [];
      if (geo.pickup && geo.dropoff) {
        const { ranked, rejected } = rankCandidates(
          {
            candidates: partners
              .filter((p) => !pendingElsewhere.has(id(p._id)))
              .map((p) => ({
                id: id(p._id),
                role: "deliveryBoy",
                isOnline: p.isOnline,
                location: p.location?.coordinates,
                locationUpdatedAt: p.locationUpdatedAt,
                activeDeliveries: busyIds.has(id(p._id)) ? 1 : 0,
                maxDistanceKm: partnerDistanceLimitKm(p.deliveryProfile?.serviceArea, geo.shop?.city, cfg),
              })),
            pickup: geo.pickup,
            dropoff: geo.dropoff,
            readyAt: so.readyAt ?? now,
            now,
            excluded,
          },
          cfg,
        );
        const describe = (partnerId: string, result: string) => {
          const p = partners.find((x) => id(x._id) === partnerId);
          const loc = p?.location?.coordinates;
          perPartner.push({
            partnerId,
            result,
            distanceKm: isValidLonLat(loc) ? round1(haversineKm(loc, geo.pickup!)) : null,
            locationAgeSeconds: p?.locationUpdatedAt ? Math.round((now.getTime() - p.locationUpdatedAt.getTime()) / 1000) : null,
          });
        };
        for (const r of ranked) describe(r.partnerId, "eligible");
        for (const r of rejected) describe(r.partnerId, r.reason);
        for (const pid of pendingElsewhere) if (partners.some((p) => id(p._id) === pid)) describe(pid, "has_pending_offer_for_another_order");
      }
      const counts = perPartner.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.result]: (acc[p.result] ?? 0) + 1 }), {});

      report.push({
        orderId: id(order._id),
        shopOrderId: id(so._id),
        orderStatus: so.status,
        pickup: geo.pickup ? (geo.pickupApproximate ? "customer_address (shop has no location)" : "shop_location") : "missing",
        job: job
          ? {
              status: job.status,
              attempts: job.attempts,
              maxAttempts: cfg.maxAttempts,
              nextRunInSeconds: Math.round((job.nextRunAt.getTime() - now.getTime()) / 1000),
              failures: job.failures ?? 0,
              lastError: job.lastError ?? null,
              noCandidateRounds: job.noCandidateRounds ?? 0,
              excludedPartners: excluded.size,
              searchWindowMinutesLeft: Math.round((cfg.maxWaitMs - (now.getTime() - (job.windowStartedAt ?? job.startedAt).getTime())) / 60_000),
            }
          : null,
        liveOffer: liveOffer
          ? { expiresInSeconds: Math.round((liveOffer.expiresAt.getTime() - now.getTime()) / 1000), ...(role === "admin" && { partnerId: id(liveOffer.partner) }) }
          : null,
        partners: { total: partners.length, ...counts },
        ...(role === "admin" && { perPartner }),
      });
    }
  }

  return {
    checkedAt: now,
    worker: dispatchWorkerState(),
    usersLocationGeoIndex: await geoIndexPresent(),
    rules: {
      maxLocationAgeSeconds: cfg.locationMaxAgeMs / 1000,
      maxPickupDistanceKm: cfg.maxPickupDistanceKm,
      serviceAreaMaxDistanceKm: cfg.serviceAreaMaxDistanceKm,
      offerTimeoutSeconds: cfg.offerTimeoutMs / 1000,
      maxAttempts: cfg.maxAttempts,
      maxWaitMinutes: cfg.maxWaitMs / 60_000,
      partnerCapacity: cfg.maxActiveDeliveries,
    },
    orders: report,
  };
};

/** A delivery partner's own view: everything that decides whether THEY can receive an offer right now. */
export const myDispatchEligibility = async (partnerId: string, now = new Date()) => {
  const cfg = defaultDispatchConfig();
  const [me, assignment, offer, geoIndex] = await Promise.all([
    User.findById(partnerId).select("role isOnline location locationUpdatedAt").lean(),
    DeliveryAssignment.findOne({ assignedTo: partnerId, status: "assigned" }).select("order shopOrderId").lean(),
    DeliveryOffer.findOne({ partner: partnerId, status: "PENDING" }).select("order expiresAt").lean(),
    geoIndexPresent(),
  ]);
  const ageSeconds = me?.locationUpdatedAt ? Math.round((now.getTime() - me.locationUpdatedAt.getTime()) / 1000) : null;
  const problems: string[] = [];
  if (me?.role !== "deliveryBoy") problems.push("account_is_not_a_delivery_partner");
  if (!me?.isOnline) problems.push("offline (dashboard socket not connected)");
  if (!isValidLonLat(me?.location?.coordinates)) problems.push("no_location_reported (allow location access on the dashboard)");
  if (ageSeconds === null || ageSeconds > cfg.locationMaxAgeMs / 1000) problems.push(`location_stale (older than ${cfg.locationMaxAgeMs / 1000}s)`);
  if (assignment) problems.push("busy_with_an_active_delivery (finish it with the delivery OTP first)");
  if (!geoIndex) problems.push("server_geo_index_missing");
  return {
    canReceiveOffers: problems.length === 0,
    problems,
    isOnline: Boolean(me?.isOnline),
    locationAgeSeconds: ageSeconds,
    activeDelivery: assignment ? { orderId: id(assignment.order), shopOrderId: id(assignment.shopOrderId) } : null,
    pendingOffer: offer ? { orderId: id(offer.order), expiresInSeconds: Math.round((offer.expiresAt.getTime() - now.getTime()) / 1000) } : null,
    worker: dispatchWorkerState(),
    maxPickupDistanceKm: cfg.maxPickupDistanceKm,
  };
};

/**
 * What the restaurant's order card shows while no partner is assigned: counts and state only, never names, phone
 * numbers or locations. "available" = partners who could take it right now (online, fresh location, within their
 * distance limit, not busy), using the worker's own rules.
 */
export const ownerDispatchSummary = async (ownerId: string, orderId: string, shopOrderId: string, now = new Date()) => {
  const cfg = defaultDispatchConfig();
  const order = await Order.findById(orderId);
  const so = order?.shopOrders.id(shopOrderId);
  if (!order || !so || id(so.owner) !== ownerId) throw AppError.notFound("Shop order not found");
  const [job, offer] = await Promise.all([
    DispatchJob.findOne({ order: order._id, shopOrderId: so._id }).select("status").lean(),
    DeliveryOffer.findOne({ order: order._id, shopOrderId: so._id, status: "PENDING", expiresAt: { $gt: now } }).select("expiresAt").lean(),
  ]);
  let available = 0;
  const geo = await resolveGeometry(order, so);
  if (!so.assignedDeliveryBoy && geo.pickup && geo.dropoff) {
    const partners = await User.find({ role: "deliveryBoy", isOnline: true, locationUpdatedAt: { $gte: new Date(now.getTime() - cfg.locationMaxAgeMs) } })
      .select("isOnline location locationUpdatedAt deliveryProfile.serviceArea")
      .limit(MAX_PARTNERS)
      .lean();
    const busy = new Set((await DeliveryAssignment.find({ assignedTo: { $in: partners.map((p) => p._id) }, status: "assigned" }).distinct("assignedTo")).map(id));
    available = rankCandidates(
      {
        candidates: partners.map((p) => ({
          id: id(p._id),
          role: "deliveryBoy",
          isOnline: p.isOnline,
          location: p.location?.coordinates,
          locationUpdatedAt: p.locationUpdatedAt,
          activeDeliveries: busy.has(id(p._id)) ? 1 : 0,
          maxDistanceKm: partnerDistanceLimitKm(p.deliveryProfile?.serviceArea, geo.shop?.city, cfg),
        })),
        pickup: geo.pickup,
        dropoff: geo.dropoff,
        readyAt: so.readyAt ?? now,
        now,
      },
      cfg,
    ).ranked.length;
  }
  return {
    orderStatus: so.status,
    assigned: Boolean(so.assignedDeliveryBoy),
    searching: job ? ["queued", "processing", "waiting_offer"].includes(job.status) : false,
    searchStopped: job?.status === "exhausted",
    availablePartners: available,
    offerPending: Boolean(offer),
    offerExpiresInSeconds: offer ? Math.max(0, Math.round((offer.expiresAt.getTime() - now.getTime()) / 1000)) : null,
  };
};
