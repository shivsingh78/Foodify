import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted = vi.hoisted(() => [] as { userId: string; event: string; payload: unknown }[]);
vi.mock("../src/events/socket.js", () => ({
  emitToUser: (userId: string, event: string, payload: unknown) => void emitted.push({ userId, event, payload }),
  initSocket: vi.fn(),
  closeSocket: vi.fn(),
  userRoom: (id: string) => `user:${id}`,
}));
vi.mock("../src/utils/mail.js", () => ({ sendOtpMail: vi.fn(async () => undefined), sendDeliveryOtpMail: vi.fn(async () => undefined) }));

const cfgOverride = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("../src/config/orchestration.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/config/orchestration.js")>();
  return { ...actual, defaultOrchestrationConfig: () => ({ ...actual.defaultOrchestrationConfig(), ...cfgOverride }) };
});

import { isRedisReady } from "../src/config/redis.js";
import { defaultOrchestrationConfig, type OrchestrationConfig } from "../src/config/orchestration.js";
import DeliveryAssignment from "../src/models/deliveryAssignment.model.js";
import DispatchJob from "../src/models/dispatchJob.model.js";
import Notification from "../src/models/notification.model.js";
import Order from "../src/models/order.model.js";
import OrchestrationState from "../src/models/orchestrationState.model.js";
import OrchestrationIncident, { HISTORY_LIMIT } from "../src/models/orchestrationIncident.model.js";
import User from "../src/models/user.model.js";
import { recoverState } from "../src/services/dispatch/dispatch.service.js";
import { metrics } from "../src/services/orchestration/metrics.js";
import { detectOverdueOrders, ensureActivationBaseline, listBacklog, overdueMinutes, processBacklogItem, runOrchestrationTick } from "../src/services/orchestration/orchestration.service.js";
import { startOrchestrationWorker, stopOrchestrationWorker } from "../src/services/orchestration/worker.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();
beforeEach(async () => {
  emitted.length = 0;
  metrics.reset();
  for (const k of Object.keys(cfgOverride)) delete cfgOverride[k];
  // An activation baseline far in the past: the behaviour tests below treat every order as post-activation.
  await OrchestrationState.create({ _id: "orchestration", activatedAt: new Date(0), lastHeartbeatAt: new Date() });
});
const EPOCH = new Date(0);
const detect = (over: Partial<OrchestrationConfig> = {}) => detectOverdueOrders(cfg(over), new Date(), EPOCH);

const MIN = 60_000;
const cfg = (over: Partial<OrchestrationConfig> = {}): OrchestrationConfig => ({
  ...defaultOrchestrationConfig(),
  enabled: true,
  preparationTimeoutMs: 10 * MIN,
  maxRecoveryAttempts: 3,
  retryDelayMs: 2 * MIN,
  batchSize: 50,
  maxDowntimeMs: 24 * 60 * MIN,
  ...over,
});
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);

/** A cash order in `status`, whose food was expected `readyMinutesAgo` minutes ago. */
const makeOrder = async (opts: { status?: string; readyMinutesAgo?: number; assigned?: Awaited<ReturnType<typeof createUserWithRole>> } = {}) => {
  const { owner, shop } = await setupShop();
  const customer = await createUserWithRole("user");
  const readyAt = at(-(opts.readyMinutesAgo ?? 30) * MIN);
  const order = await Order.create({
    user: customer.user._id,
    paymentMethod: "cod",
    deliveryAddress: address,
    totalAmount: 300,
    shopOrders: [
      {
        shop: shop._id,
        owner: owner.user._id,
        subtotal: 300,
        status: opts.status ?? "preparing",
        preparingAt: new Date(readyAt.getTime() - 15 * MIN),
        readyAt,
        ...(opts.assigned && {
          assignedDeliveryBoy: opts.assigned.user._id,
          eta: { predictedAt: at(-40 * MIN), basis: "assignment", pickupAt: at(-20 * MIN), deliveryAt: at(-5 * MIN) },
          etaAtAssignment: { predictedAt: at(-40 * MIN), basis: "assignment", pickupAt: at(-20 * MIN), deliveryAt: at(-5 * MIN) },
        }),
      },
    ],
  });
  return { order, shopOrder: order.shopOrders[0]!, owner, customer, shop };
};
const reload = async (orderId: unknown) => (await Order.findById(orderId))!.shopOrders[0]!;
const incidents = () => OrchestrationIncident.find({}).lean();
const countNotes = (userId: unknown, type?: string) => Notification.countDocuments({ user: userId, ...(type && { type }) });

describe("detection", () => {
  it("ignores orders inside the preparation threshold", async () => {
    await makeOrder({ readyMinutesAgo: 5 }); // 5 min late, timeout is 10
    expect(await detect()).toBe(0);
    expect(await incidents()).toHaveLength(0);
  });

  it("creates exactly one incident for an overdue order, and repeated or concurrent scans add none", async () => {
    const { order } = await makeOrder({ readyMinutesAgo: 30 });
    const results = await Promise.all([detect(), detect(), detect()]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    await detect();
    const all = await incidents();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "open", active: true, anomalyType: "preparation_overdue", attempts: 0 });
    expect(String(all[0]!.order)).toBe(String(order._id));
    expect(all[0]!.observed.overdueMinutes).toBeGreaterThanOrEqual(19);
  });

  it("never detects pending, delivered, cancelled or out-for-delivery orders", async () => {
    for (const status of ["pending", "out of delivery", "delivered", "cancelled"]) await makeOrder({ status });
    expect(await detect()).toBe(0);
  });

  it("falls back to preparingAt + default prep time for orders without readyAt", async () => {
    const so = { status: "preparing" as const, readyAt: null, preparingAt: at(-60 * MIN), pickedUpAt: null };
    expect(overdueMinutes(so, new Date(), cfg())).toBeGreaterThan(30);
    expect(overdueMinutes({ ...so, preparingAt: at(-5 * MIN) }, new Date(), cfg())).toBeNull();
    expect(overdueMinutes({ ...so, preparingAt: null }, new Date(), cfg())).toBeNull();
  });

  it("scans in bounded batches without starving later orders", async () => {
    for (let i = 0; i < 5; i++) await makeOrder({ readyMinutesAgo: 30 });
    expect(await detect({ batchSize: 2 })).toBe(5);
  });

  it("creates a new incident only after the previous one is closed", async () => {
    const { order } = await makeOrder();
    await detect();
    await OrchestrationIncident.updateMany({}, { active: false, status: "resolved" });
    await detect();
    expect(await incidents()).toHaveLength(2);
    expect(String((await incidents())[1]!.order)).toBe(String(order._id));
  });
});

describe("safe recovery", () => {
  it("makes a bounded attempt: notifies once, never changes the order status, and schedules a retry", async () => {
    const { order, owner, customer } = await makeOrder();
    await runOrchestrationTick(cfg());
    const [inc] = await incidents();
    expect(inc).toMatchObject({ status: "open", attempts: 1, outcome: "retry_scheduled" });
    expect(inc!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + MIN);
    expect((await reload(order._id)).status).toBe("preparing");
    expect(await countNotes(owner.user._id, "order_delayed")).toBe(1);
    expect(await countNotes(customer.user._id, "order_delayed")).toBe(1);
    expect(inc!.history.map((h) => h.event)).toEqual(expect.arrayContaining(["detected", "attempt_started", "notified", "retry_scheduled"]));
  });

  it("does not retry before the scheduled time, and stops notifying people on later attempts", async () => {
    const { owner } = await makeOrder();
    await runOrchestrationTick(cfg());
    await runOrchestrationTick(cfg(), at(MIN)); // 1 min later: retry delay is 2 min
    expect((await incidents())[0]!.attempts).toBe(1);
    await runOrchestrationTick(cfg(), at(3 * MIN));
    expect((await incidents())[0]!.attempts).toBe(2);
    expect(await countNotes(owner.user._id, "order_delayed")).toBe(1);
  });

  it("bounds attempts, then escalates once and notifies every admin exactly once", async () => {
    const adminA = await createUserWithRole("admin");
    const adminB = await createUserWithRole("admin");
    const { order } = await makeOrder();
    for (let i = 0; i < 8; i++) await runOrchestrationTick(cfg(), at(i * 3 * MIN)); // far more ticks than attempts
    const [inc] = await incidents();
    expect(inc).toMatchObject({ status: "escalated", active: true, attempts: 3, outcome: "escalated", escalationReason: "recovery attempts exhausted" });
    expect(inc!.escalatedAt).toBeTruthy();
    expect(await countNotes(adminA.user._id, "incident_escalated")).toBe(1);
    expect(await countNotes(adminB.user._id, "incident_escalated")).toBe(1);
    expect(inc!.history.filter((h) => h.event === "escalated")).toHaveLength(1);
    expect((await reload(order._id)).status).toBe("preparing"); // still never touched
    expect(emitted.filter((e) => e.event === "orderIncidentEscalated").map((e) => e.userId).sort()).toEqual([adminA.user._id, adminB.user._id].sort());
  });

  it("does not leak incident events to the customer or other users", async () => {
    const admin = await createUserWithRole("admin");
    const { owner, customer } = await makeOrder();
    const stranger = await createUserWithRole("user");
    for (let i = 0; i < 4; i++) await runOrchestrationTick(cfg(), at(i * 3 * MIN));
    const incidentEvents = emitted.filter((e) => e.event.startsWith("order") && e.event !== "orderStatus");
    expect(incidentEvents.length).toBeGreaterThan(0);
    for (const e of incidentEvents) expect([owner.user._id, admin.user._id]).toContain(e.userId);
    expect(emitted.some((e) => e.userId === customer.user._id && e.event.startsWith("order"))).toBe(false);
    expect(emitted.some((e) => e.userId === stranger.user._id)).toBe(false);
    expect(JSON.stringify(emitted)).not.toMatch(/address|Street|deliveryOtp/i);
  });

  it("leaves an order alone, and closes the incident as recovered, if it moved on before the attempt", async () => {
    const { order, owner } = await makeOrder();
    await detect();
    await Order.updateOne({ _id: order._id, "shopOrders._id": order.shopOrders[0]!._id }, { $set: { "shopOrders.$.status": "out of delivery" } });
    await runOrchestrationTick(cfg());
    const [inc] = await incidents();
    expect(inc).toMatchObject({ status: "recovered", active: false, outcome: "order_progressed", attempts: 1 });
    expect(inc!.history.map((h) => h.event)).toContain("skipped_state_changed");
    expect((await reload(order._id)).status).toBe("out of delivery");
    expect(await countNotes(owner.user._id)).toBe(0);
    expect(emitted.some((e) => e.event === "orderRecoverySucceeded")).toBe(true);
  });

  it("never recovers a cancelled or delivered order: the incident is closed untouched", async () => {
    for (const status of ["cancelled", "delivered"]) {
      await OrchestrationIncident.deleteMany({});
      const { order, owner } = await makeOrder();
      await detect();
      await Order.updateOne({ _id: order._id, "shopOrders._id": order.shopOrders[0]!._id }, { $set: { "shopOrders.$.status": status } });
      await runOrchestrationTick(cfg());
      expect((await incidents())[0]).toMatchObject({ active: false });
      expect((await reload(order._id)).status).toBe(status);
      expect(await countNotes(owner.user._id)).toBe(0);
      expect(await DispatchJob.countDocuments({ order: order._id })).toBe(0);
    }
  });

  it("runs a recovery action only once when workers race", async () => {
    const { owner, customer } = await makeOrder();
    await detect();
    await Promise.all([1, 2, 3, 4].map((n) => runOrchestrationTick(cfg(), new Date(), `worker-${n}`)));
    const [inc] = await incidents();
    expect(inc!.attempts).toBe(1);
    expect(inc!.history.filter((h) => h.event === "attempt_started")).toHaveLength(1);
    expect(await countNotes(owner.user._id, "order_delayed")).toBe(1);
    expect(await countNotes(customer.user._id, "order_delayed")).toBe(1);
  });

  it("takes over an incident whose worker crashed (expired lease) and still counts the attempt", async () => {
    await makeOrder();
    await detect();
    await OrchestrationIncident.updateMany({}, { status: "recovering", lockedBy: "dead-worker", lockedUntil: at(-MIN), attempts: 1 });
    await runOrchestrationTick(cfg());
    expect((await incidents())[0]).toMatchObject({ attempts: 2, status: "open" });
    // a live lease is respected
    await OrchestrationIncident.updateMany({}, { status: "recovering", lockedBy: "busy-worker", lockedUntil: at(30 * MIN) });
    await runOrchestrationTick(cfg(), at(10 * MIN));
    expect((await incidents())[0]!.attempts).toBe(2);
  });

  it("recalculates the ETA with the existing model when a partner is assigned, keeping the original prediction", async () => {
    const rider = await createUserWithRole("deliveryBoy");
    await User.updateOne({ _id: rider.user._id }, { isOnline: true, location: { type: "Point", coordinates: [address.longitude, address.latitude + 0.01] } });
    const { order, customer } = await makeOrder({ assigned: rider });
    const before = await reload(order._id);
    await runOrchestrationTick(cfg());
    const after = await reload(order._id);
    expect(after.eta!.basis).toBe("delay_recovery");
    expect(after.eta!.deliveryAt.getTime()).toBeGreaterThan(Date.now());
    expect(after.etaAtAssignment!.basis).toBe("assignment");
    expect(after.etaAtAssignment!.deliveryAt.getTime()).toBe(before.etaAtAssignment!.deliveryAt.getTime());
    expect(after.status).toBe("preparing");
    expect(emitted.some((e) => e.event === "etaUpdated" && e.userId === String(customer.user._id))).toBe(true);
    expect((await incidents())[0]!.history.map((h) => h.event)).toContain("eta_recalculated");
    expect(await countNotes(rider.user._id, "order_delayed")).toBe(1);
  });

  it("skips the ETA (and says why) when no partner is assigned", async () => {
    await makeOrder();
    await runOrchestrationTick(cfg());
    expect((await incidents())[0]!.history.find((h) => h.event === "eta_skipped")?.detail).toBe("no_assignment");
  });

  it("creates a dispatch job only when none exists and nothing is assigned", async () => {
    const { order, shopOrder } = await makeOrder();
    await runOrchestrationTick(cfg());
    expect(await DispatchJob.countDocuments({ order: order._id })).toBe(1);
    await runOrchestrationTick(cfg(), at(3 * MIN));
    expect(await DispatchJob.countDocuments({ order: order._id })).toBe(1);

    // an active assignment means: no new job, no offer
    const rider = await createUserWithRole("deliveryBoy");
    const b = await makeOrder();
    await DeliveryAssignment.create({ order: b.order._id, shop: b.shop._id, shopOrderId: b.shopOrder._id, assignedTo: rider.user._id, status: "assigned" });
    await runOrchestrationTick(cfg(), at(6 * MIN));
    expect(await DispatchJob.countDocuments({ order: b.order._id })).toBe(0);
    void shopOrder;
  });

  it("records a failure without corrupting the order or losing the retry", async () => {
    const { order } = await makeOrder();
    const spy = vi.spyOn(DispatchJob, "exists").mockImplementationOnce((() => Promise.reject(new Error("db down mongodb://user:pw@host/db"))) as never);
    await runOrchestrationTick(cfg());
    spy.mockRestore();
    const [inc] = await incidents();
    expect(inc).toMatchObject({ status: "open", attempts: 1 });
    expect(inc!.failureReason).toContain("db down");
    expect(inc!.failureReason).not.toContain("pw@host");
    expect(inc!.history.some((h) => h.event === "attempt_failed")).toBe(true);
    const so = await reload(order._id);
    expect(so.status).toBe("preparing");
  });

  it("keeps the incident history bounded", async () => {
    await makeOrder();
    await detect();
    for (let i = 0; i < 4; i++) {
      await OrchestrationIncident.updateMany({}, { $push: { history: { $each: Array.from({ length: 30 }, () => ({ at: new Date(), event: "notified" })), $slice: -HISTORY_LIMIT } } });
    }
    await runOrchestrationTick(cfg());
    expect((await incidents())[0]!.history.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });
});

describe("degraded infrastructure", () => {
  it("does not depend on Redis: the whole flow works with Redis absent", async () => {
    expect(isRedisReady()).toBe(false);
    const { owner } = await makeOrder();
    await runOrchestrationTick(cfg());
    expect(await countNotes(owner.user._id, "order_delayed")).toBe(1);
  });

  it("starts and stops cleanly, and stays off when disabled", async () => {
    startOrchestrationWorker(cfg({ enabled: false }));
    startOrchestrationWorker(cfg({ checkIntervalMs: 600_000 }));
    startOrchestrationWorker(cfg({ checkIntervalMs: 600_000 })); // idempotent
    await stopOrchestrationWorker();
    await stopOrchestrationWorker();
  });
});

describe("admin incident API", () => {
  const as = (cookie: string) => ({
    get: (url: string) => request(app).get(url).set("Cookie", cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set("Cookie", cookie).send(body),
  });
  const escalated = async () => {
    const { order } = await makeOrder();
    for (let i = 0; i < 5; i++) await runOrchestrationTick(cfg(), at(i * 3 * MIN));
    return { order, incident: (await incidents())[0]! };
  };

  it("rejects anonymous, customer, owner and delivery-partner access to every incident endpoint", async () => {
    const { incident } = await escalated();
    const id = String(incident._id);
    const routes: [string, string][] = [
      ["get", "/api/admin/incidents"],
      ["get", "/api/admin/incidents/metrics"],
      ["get", `/api/admin/incidents/${id}`],
      ["post", `/api/admin/incidents/${id}/resolve`],
      ["post", `/api/admin/incidents/${id}/retry`],
    ];
    for (const [method, url] of routes) {
      const anon = method === "get" ? await request(app).get(url) : await request(app).post(url).send({ reason: "because" });
      expect(anon.status).toBe(401);
    }
    for (const role of ["user", "owner", "deliveryBoy"] as const) {
      const { cookie } = await createUserWithRole(role);
      for (const [method, url] of routes) {
        const res = method === "get" ? await as(cookie).get(url) : await as(cookie).post(url, { reason: "because" });
        expect(res.status).toBe(403);
      }
    }
    expect((await OrchestrationIncident.findById(id))!.status).toBe("escalated"); // untouched
  });

  it("lets an admin list, filter, inspect, and read metrics", async () => {
    const { cookie } = await createUserWithRole("admin");
    const { incident } = await escalated();
    const list = await as(cookie).get("/api/admin/incidents?status=escalated&limit=5");
    expect(list.status).toBe(200);
    expect(list.body.incidents).toHaveLength(1);
    expect(list.body.incidents[0].history).toBeUndefined();
    expect(list.body.pagination.total).toBe(1);
    expect((await as(cookie).get("/api/admin/incidents?status=open")).body.incidents).toHaveLength(0);
    expect((await as(cookie).get("/api/admin/incidents?status=bogus")).status).toBe(400);

    const one = await as(cookie).get(`/api/admin/incidents/${incident._id}`);
    expect(one.status).toBe(200);
    expect(one.body.history.length).toBeGreaterThan(3);
    expect(one.body.shopName).toBeTruthy();
    expect((await as(cookie).get("/api/admin/incidents/not-an-id")).status).toBe(400);
    expect((await as(cookie).get(`/api/admin/incidents/${new mongoose.Types.ObjectId()}`)).status).toBe(404);

    const m = await as(cookie).get("/api/admin/incidents/metrics");
    expect(m.status).toBe(200);
    expect(m.body.openIncidents).toBe(1);
    expect(m.body.incidents.escalated).toBe(1);
    expect(m.body.process.escalated).toBeGreaterThanOrEqual(1);
  });

  it("manual retry grants exactly one more attempt through the normal safety checks, then escalates again", async () => {
    const admin = await createUserWithRole("admin");
    const { order, incident } = await escalated();
    const retry = await as(admin.cookie).post(`/api/admin/incidents/${incident._id}/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ status: "open", attemptLimit: 4 });
    expect((await as(admin.cookie).post(`/api/admin/incidents/${incident._id}/retry`)).status).toBe(409); // no longer escalated

    for (let i = 0; i < 5; i++) await runOrchestrationTick(cfg(), at(20 * MIN + i * 3 * MIN));
    const after = (await incidents())[0]!;
    expect(after).toMatchObject({ status: "escalated", attempts: 4 });
    expect(after.history.filter((h) => h.event === "manual_retry")).toHaveLength(1);
    expect(String(after.history.find((h) => h.event === "manual_retry")!.actor)).toBe(admin.user._id);
    expect(await countNotes(admin.user._id, "incident_escalated")).toBe(2); // once per escalation
    expect((await reload(order._id)).status).toBe("preparing");
  });

  it("manual retry does nothing to an order that changed state", async () => {
    const admin = await createUserWithRole("admin");
    const { order, incident } = await escalated();
    await Order.updateOne({ _id: order._id, "shopOrders._id": order.shopOrders[0]!._id }, { $set: { "shopOrders.$.status": "cancelled" } });
    await as(admin.cookie).post(`/api/admin/incidents/${incident._id}/retry`);
    await runOrchestrationTick(cfg(), at(30 * MIN));
    expect((await incidents())[0]).toMatchObject({ active: false, status: "resolved" });
    expect((await reload(order._id)).status).toBe("cancelled");
  });

  it("resolves with a documented reason, once, recording who did it", async () => {
    const admin = await createUserWithRole("admin");
    const { incident } = await escalated();
    expect((await as(admin.cookie).post(`/api/admin/incidents/${incident._id}/resolve`, {})).status).toBe(400);
    expect((await as(admin.cookie).post(`/api/admin/incidents/${incident._id}/resolve`, { reason: "x" })).status).toBe(400);
    const ok = await as(admin.cookie).post(`/api/admin/incidents/${incident._id}/resolve`, { reason: "Called the restaurant, food is ready" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "resolved", active: false, resolutionReason: "Called the restaurant, food is ready", resolvedBy: admin.user._id });
    expect((await as(admin.cookie).post(`/api/admin/incidents/${incident._id}/resolve`, { reason: "again please" })).status).toBe(409);
    expect((await as(admin.cookie).post(`/api/admin/incidents/${incident._id}/retry`)).status).toBe(409);
  });
});

describe("rollout safety: disabled by default", () => {
  it("is off unless ORCHESTRATION_ENABLED=true is set explicitly", async () => {
    const actual = await vi.importActual<typeof import("../src/config/orchestration.js")>("../src/config/orchestration.js");
    expect(process.env.ORCHESTRATION_ENABLED).toBeUndefined();
    expect(actual.defaultOrchestrationConfig().enabled).toBe(false);

    vi.resetModules();
    process.env.ORCHESTRATION_ENABLED = "true";
    try {
      const enabled = await vi.importActual<typeof import("../src/config/orchestration.js")>("../src/config/orchestration.js");
      expect(enabled.defaultOrchestrationConfig().enabled).toBe(true);
      process.env.ORCHESTRATION_ENABLED = "maybe";
      vi.resetModules();
      await expect(import("../src/config/env.js")).rejects.toThrow(/ORCHESTRATION_ENABLED/);
    } finally {
      delete process.env.ORCHESTRATION_ENABLED;
      vi.resetModules();
    }
  });

  it("does nothing while disabled: no baseline, incidents, retries or notifications; ordinary dispatch recovery still works", async () => {
    const { order, owner, customer } = await makeOrder({ readyMinutesAgo: 30 });
    await OrchestrationState.deleteMany({});
    const off = cfg({ enabled: false });
    expect(await runOrchestrationTick(off)).toMatchObject({ detected: 0, processed: 0, disabled: true });
    startOrchestrationWorker(off);
    await new Promise((r) => setTimeout(r, 50));
    await stopOrchestrationWorker();

    expect(await incidents()).toHaveLength(0);
    expect(await OrchestrationState.countDocuments()).toBe(0);
    expect(await countNotes(owner.user._id)).toBe(0);
    expect(await countNotes(customer.user._id)).toBe(0);
    expect(emitted).toHaveLength(0);

    // an incident that already exists is not retried while disabled
    await detect();
    await runOrchestrationTick(off, at(10 * MIN));
    expect((await incidents())[0]).toMatchObject({ attempts: 0, status: "open" });

    // the ordinary order pipeline is unaffected: dispatch's own recovery still creates the dispatch job
    await recoverState();
    expect(await DispatchJob.countDocuments({ order: order._id })).toBe(1);
    expect((await reload(order._id)).status).toBe("preparing");
  });
});

describe("rollout safety: activation baseline", () => {
  beforeEach(async () => void (await OrchestrationState.deleteMany({})));

  it("does not touch orders that were already overdue when the engine is first activated", async () => {
    const late = await makeOrder({ readyMinutesAgo: 45 });
    const stillOk = await makeOrder({ readyMinutesAgo: -5 }); // food expected in 5 minutes: not late yet
    const first = await runOrchestrationTick(cfg());
    expect(first).toMatchObject({ detected: 0, processed: 0 });
    expect(await incidents()).toHaveLength(0);
    expect(await countNotes(late.owner.user._id)).toBe(0);
    expect(await countNotes(late.customer.user._id)).toBe(0);
    const state = await OrchestrationState.findById("orchestration");
    expect(state).toBeTruthy();

    // ...but an order that becomes overdue after activation is handled normally
    const later = at(20 * MIN);
    await runOrchestrationTick(cfg(), later);
    const all = await incidents();
    expect(all).toHaveLength(1);
    expect(String(all[0]!.order)).toBe(String(stillOk.order._id));
    expect(await countNotes(stillOk.owner.user._id, "order_delayed")).toBe(1);
    expect(await countNotes(late.owner.user._id)).toBe(0);
  });

  it("keeps the same baseline across restarts and across concurrent instances", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => ensureActivationBaseline(cfg(), new Date())));
    expect(await OrchestrationState.countDocuments()).toBe(1);
    expect(new Set(results.map((r) => r.baseline.getTime())).size).toBe(1);
    expect(results.filter((r) => r.change === "created").length).toBeGreaterThanOrEqual(1);

    const first = (await OrchestrationState.findById("orchestration"))!.activatedAt;
    const restart = await ensureActivationBaseline(cfg(), at(5 * MIN)); // a normal restart: short gap
    expect(restart).toMatchObject({ change: null });
    expect(restart.baseline.getTime()).toBe(first.getTime());
    expect((await OrchestrationState.findById("orchestration"))!.activatedAt.getTime()).toBe(first.getTime());
  });

  it("several instances ticking at once create each incident and notification only once", async () => {
    const { owner } = await makeOrder({ readyMinutesAgo: -1 });
    await runOrchestrationTick(cfg()); // activation
    const later = at(20 * MIN);
    await Promise.all([1, 2, 3, 4].map((n) => runOrchestrationTick(cfg(), later, `instance-${n}`)));
    expect(await incidents()).toHaveLength(1);
    expect((await incidents())[0]!.attempts).toBe(1);
    expect(await countNotes(owner.user._id, "order_delayed")).toBe(1);
  });

  it("does not re-notify after a restart", async () => {
    const { owner, customer } = await makeOrder({ readyMinutesAgo: -1 });
    await runOrchestrationTick(cfg());
    await runOrchestrationTick(cfg(), at(20 * MIN));
    await ensureActivationBaseline(cfg(), at(21 * MIN)); // "restart"
    await runOrchestrationTick(cfg(), at(24 * MIN));
    await runOrchestrationTick(cfg(), at(27 * MIN));
    expect(await countNotes(owner.user._id, "order_delayed")).toBe(1);
    expect(await countNotes(customer.user._id, "order_delayed")).toBe(1);
  });

  it("after a long outage or rollback the baseline moves forward, so downtime is not turned into a burst", async () => {
    const { order, owner } = await makeOrder({ readyMinutesAgo: -1 });
    await runOrchestrationTick(cfg({ maxDowntimeMs: 15 * MIN })); // active
    // engine is switched off; the order goes overdue meanwhile; it is re-enabled an hour later
    const reenabled = at(60 * MIN);
    const result = await runOrchestrationTick(cfg({ maxDowntimeMs: 15 * MIN }), reenabled);
    expect(result.detected).toBe(0);
    expect((await OrchestrationState.findById("orchestration"))!.activatedAt.getTime()).toBe(reenabled.getTime());
    expect(await incidents()).toHaveLength(0);
    expect(await countNotes(owner.user._id)).toBe(0);

    // it is visible to administrators instead
    const backlog = await listBacklog({ page: 1, limit: 20 }, cfg(), reenabled);
    expect(backlog.items.map((i) => i.orderId)).toEqual([String(order._id)]);
  });
});

describe("rollout safety: administrator backlog", () => {
  beforeEach(async () => void (await OrchestrationState.deleteMany({})));
  const as = (cookie: string) => ({
    get: (url: string) => request(app).get(url).set("Cookie", cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set("Cookie", cookie).send(body),
  });

  it("lists pre-existing overdue orders (ids and timing only) and lets an admin process one deliberately", async () => {
    const admin = await createUserWithRole("admin");
    const late = await makeOrder({ readyMinutesAgo: 45 });
    const fresh = await makeOrder({ readyMinutesAgo: 2 });
    await runOrchestrationTick(cfg()); // activation: the late order is pre-existing

    const list = await as(admin.cookie).get("/api/admin/incidents/backlog");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ orderId: String(late.order._id), shopOrderId: String(late.shopOrder._id), hasActiveIncident: false });
    expect(list.body.items[0].overdueMinutes).toBeGreaterThanOrEqual(35);
    expect(JSON.stringify(list.body)).not.toMatch(/address|Street|email|mobile/i);
    expect(await incidents()).toHaveLength(0); // listing is read-only

    cfgOverride.enabled = true;
    const body = { orderId: String(late.order._id), shopOrderId: String(late.shopOrder._id) };
    const created = await as(admin.cookie).post("/api/admin/incidents/backlog/process", body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "open", active: true });
    expect((await as(admin.cookie).post("/api/admin/incidents/backlog/process", body)).status).toBe(409); // already has one
    expect((await as(admin.cookie).get("/api/admin/incidents/backlog")).body.items[0].hasActiveIncident).toBe(true);

    // only after the deliberate action does the normal worker notify, and only once
    expect(await countNotes(late.owner.user._id)).toBe(0);
    await runOrchestrationTick(cfg(), at(MIN));
    await runOrchestrationTick(cfg(), at(5 * MIN));
    expect(await countNotes(late.owner.user._id, "order_delayed")).toBe(1);
    const history = (await incidents())[0]!.history;
    expect(history[0]!.detail).toContain("pre-activation backlog");
    expect(String(history[0]!.actor)).toBe(admin.user._id);

    // an order that is not overdue cannot be pushed through this door
    const notLate = await as(admin.cookie).post("/api/admin/incidents/backlog/process", { orderId: String(fresh.order._id), shopOrderId: String(fresh.shopOrder._id) });
    expect(notLate.status).toBe(409);
    expect((await as(admin.cookie).post("/api/admin/incidents/backlog/process", { orderId: "x", shopOrderId: "y" })).status).toBe(400);
  });

  it("refuses to process the backlog while orchestration is disabled", async () => {
    const admin = await createUserWithRole("admin");
    const late = await makeOrder({ readyMinutesAgo: 45 });
    const res = await as(admin.cookie).post("/api/admin/incidents/backlog/process", { orderId: String(late.order._id), shopOrderId: String(late.shopOrder._id) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ORCHESTRATION_DISABLED");
    expect(await incidents()).toHaveLength(0);
    void processBacklogItem;
  });

  it("keeps the backlog endpoints admin-only", async () => {
    for (const role of ["user", "owner", "deliveryBoy"] as const) {
      const { cookie } = await createUserWithRole(role);
      expect((await as(cookie).get("/api/admin/incidents/backlog")).status).toBe(403);
      expect((await as(cookie).post("/api/admin/incidents/backlog/process", {})).status).toBe(403);
    }
    expect((await request(app).get("/api/admin/incidents/backlog")).status).toBe(401);
  });
});
