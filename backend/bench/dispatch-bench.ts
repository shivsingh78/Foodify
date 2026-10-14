/**
 * Dispatch benchmark (reproducible, non-destructive: uses a throw-away in-memory MongoDB).
 *
 *   pnpm --filter backend bench:dispatch            # defaults: 200 orders, 60 partners
 *   ORDERS=500 PARTNERS=100 pnpm --filter backend bench:dispatch
 *
 * It drives the real dispatch services (ranking, offers, assignment) in ONE process, with simulated partners that
 * accept after a random 50-300 ms "think time" and finish a delivery 300 ms later. It does not include HTTP, Socket.IO,
 * or a real network database, so treat the numbers as a baseline for the engine, not as production capacity.
 */
import { MongoMemoryServer } from "mongodb-memory-server";

const ORDERS = Number(process.env.ORDERS ?? 200);
const PARTNERS = Number(process.env.PARTNERS ?? 60);

const mongod = await MongoMemoryServer.create();
Object.assign(process.env, {
  NODE_ENV: "test",
  MONGODB_URL: mongod.getUri(),
  JWT_SECRET: "bench-secret-bench-secret-bench-secret-1",
  DISPATCH_ENABLE_WORKER: "false",
});

const { default: mongoose } = await import("mongoose");
const { defaultDispatchConfig } = await import("../src/config/dispatch.js");
const { default: User } = await import("../src/models/user.model.js");
const { default: Order } = await import("../src/models/order.model.js");
const { default: Shop } = await import("../src/models/shop.model.js");
const { default: DispatchJob } = await import("../src/models/dispatchJob.model.js");
const { default: DeliveryOffer } = await import("../src/models/deliveryOffer.model.js");
const { default: DeliveryAssignment } = await import("../src/models/deliveryAssignment.model.js");
const { runDispatchTick, acceptOffer, enqueueDispatch } = await import("../src/services/dispatch/dispatch.service.js");
const { getDispatchMetrics } = await import("../src/services/dispatch/metrics.service.js");

await mongoose.connect(mongod.getUri(), { dbName: "bench" });
await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

const centre = { lon: 73.85, lat: 18.52 };
const jitter = (n: number) => (Math.random() - 0.5) * n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const owner = await User.create({ fullName: "Owner", email: "o@bench.dev", mobile: "1", role: "owner" });
const customer = await User.create({ fullName: "Cust", email: "c@bench.dev", mobile: "1", role: "user" });
const shop = await Shop.create({ name: "Bench", image: "x", owner: owner._id, city: "Pune", state: "MH", address: "a" });
const partners = await User.insertMany(
  Array.from({ length: PARTNERS }, (_, i) => ({
    fullName: `P${i}`, email: `p${i}@bench.dev`, mobile: "1", role: "deliveryBoy", isOnline: true, locationUpdatedAt: new Date(),
    location: { type: "Point", coordinates: [centre.lon + jitter(0.04), centre.lat + jitter(0.04)] },
  })),
);

const readyAt = new Date(Date.now() + 5 * 60_000);
const orders = await Order.insertMany(
  Array.from({ length: ORDERS }, () => ({
    user: customer._id, paymentMethod: "cod", totalAmount: 100,
    deliveryAddress: { text: "bench", latitude: centre.lat + jitter(0.04), longitude: centre.lon + jitter(0.04) },
    shopOrders: [{ shop: shop._id, owner: owner._id, subtotal: 100, status: "preparing", preparingAt: new Date(), readyAt, shopOrderItems: [] }],
  })),
);

const cfg = { ...defaultDispatchConfig(), retryDelayMs: 200, offerTimeoutMs: 5000, maxWaitMs: 120_000 };
const startedAt = Date.now();
await Promise.all(orders.map((o) => enqueueDispatch(o._id, o.shopOrders[0]!._id, readyAt)));
let acceptedCalls = 0, acceptFailures = 0;
const failureCodes: Record<string, number> = {};

const partnerById = new Set(partners.map((p) => String(p._id)));
const handled = new Set<string>();
const respond = async () => {
  const pending = await DeliveryOffer.find({ status: "PENDING" }).lean();
  await Promise.all(
    pending.filter((o) => !handled.has(String(o._id))).map(async (o) => {
      handled.add(String(o._id));
      await sleep(50 + Math.random() * 250); // partner think time
      acceptedCalls++;
      try {
        await acceptOffer(String(o.partner), String(o._id));
        await sleep(300); // delivery done: free the partner
        await DeliveryAssignment.updateOne({ order: o.order, shopOrderId: o.shopOrderId, status: "assigned" }, { status: "completed" });
      } catch (e) { acceptFailures++; const c = (e as { code?: string }).code ?? "ERROR"; failureCodes[c] = (failureCodes[c] ?? 0) + 1; }
    }),
  );
};

let ticks = 0;
let running = true;
// Partners respond independently of the worker, like real clients would.
const responder = (async () => { while (running) { await respond(); await sleep(25); } })();

const deadline = Date.now() + 120_000;
for (;;) {
  const open = await DispatchJob.countDocuments({ status: { $in: ["queued", "processing", "waiting_offer"] } });
  if (open === 0 || Date.now() > deadline) break;
  await runDispatchTick(cfg, 5);
  ticks++;
  await sleep(100);
}
running = false;
await responder;
const elapsed = (Date.now() - startedAt) / 1000;

const m = await getDispatchMetrics(1);
const byStatus = m.jobs.byStatus;
console.log(JSON.stringify({
  setup: { orders: ORDERS, partners: PARTNERS, workerConcurrency: 5, node: process.version, db: "mongodb-memory-server (single node, in-process)" },
  elapsedSeconds: Number(elapsed.toFixed(2)),
  assignmentsPerSecond: Number(((byStatus.assigned ?? 0) / elapsed).toFixed(2)),
  jobsByStatus: byStatus,
  assignmentLatencySeconds: m.assignmentLatencySeconds,
  assignmentSuccessRate: m.assignmentSuccessRate,
  offers: m.offers,
  attemptsPerOrder: m.attemptsPerOrder,
  workerFailures: m.workerFailures,
  acceptCalls: acceptedCalls,
  acceptCallFailures: acceptFailures,
  acceptFailureCodes: failureCodes,
  ticks,
  doubleAssignedOrders: (await DeliveryAssignment.aggregate([{ $group: { _id: "$shopOrderId", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])).length,
  partnersThatNeverGotWork: partnerById.size - new Set((await DeliveryOffer.find({}).select("partner").lean()).map((o) => String(o.partner))).size,
}, null, 2));

await mongoose.disconnect();
await mongod.stop();
