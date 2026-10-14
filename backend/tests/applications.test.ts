import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/cloudinary.js", () => ({
  uploadOnCloudinary: vi.fn(async () => "https://res.cloudinary.com/demo/image/upload/v1/shop.jpg"),
  deleteFromCloudinary: vi.fn(async () => undefined),
}));
vi.mock("../src/utils/mail.js", () => ({
  sendOtpMail: vi.fn(async () => undefined),
  sendDeliveryOtpMail: vi.fn(async () => undefined),
}));

import RoleApplication from "../src/models/application.model.js";
import Notification from "../src/models/notification.model.js";
import Shop from "../src/models/shop.model.js";
import { approveApplication } from "../src/services/application.service.js";
import { app, createUserWithRole, signUp, useTestDb } from "./helpers.js";

useTestDb();
const User = () => mongoose.model("User");

const ownerForm = {
  businessName: "Spice Garden",
  description: "Family kitchen",
  contactPhone: "9876543210",
  address: "12 MG Road",
  city: "Pune",
  state: "MH",
  latitude: "18.52",
  longitude: "73.85",
};
const applyOwner = (cookie: string, over: Record<string, string> = {}, withImage = true) => {
  const req = request(app).post("/api/applications/owner").set("Cookie", cookie);
  for (const [k, v] of Object.entries({ ...ownerForm, ...over })) req.field(k, v);
  if (withImage) req.attach("image", Buffer.from("fake"), { filename: "shop.png", contentType: "image/png" });
  return req;
};
const deliveryForm = { contactPhone: "9876543210", vehicleType: "motorcycle", vehicleNumber: "MH12AB1234", serviceArea: "Pune East" };
const applyDelivery = (cookie: string, over: Record<string, unknown> = {}) =>
  request(app).post("/api/applications/delivery-partner").set("Cookie", cookie).send({ ...deliveryForm, ...over });
const admin = () => createUserWithRole("admin");
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  request(app).post(`/api/admin/applications/${id}/${action}`).set("Cookie", cookie).send(body);
const roleOf = async (id: string) => (await User().findById(id).lean<{ role: string }>())?.role;

beforeEach(() => undefined);

describe("submitting applications", () => {
  it("lets a customer apply as owner; the application is pending and grants nothing", async () => {
    const c = await signUp();
    const res = await applyOwner(c.cookie);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: "owner", status: "pending" });
    expect(res.body.ownerData.image).toContain("cloudinary");
    expect(await roleOf(c.user._id)).toBe("user");
    expect(await Shop.countDocuments({})).toBe(0);
    expect(await Notification.countDocuments({ user: c.user._id, type: "application_submitted" })).toBe(1);
  });

  it("lets a customer apply as delivery partner without gaining the role", async () => {
    const c = await signUp();
    const res = await applyDelivery(c.cookie);
    expect(res.status).toBe(201);
    expect(await roleOf(c.user._id)).toBe("user");
    const rider = await request(app).get("/api/order/get-assignments").set("Cookie", c.cookie);
    expect(rider.status).toBe(403);
  });

  it("requires authentication and valid data", async () => {
    expect((await request(app).post("/api/applications/delivery-partner").send(deliveryForm)).status).toBe(401);
    const c = await signUp();
    expect((await applyOwner(c.cookie, {}, false)).status).toBe(400);
    expect((await applyOwner(c.cookie, { latitude: "120" })).status).toBe(400);
    expect((await applyOwner(c.cookie, { businessName: "" })).status).toBe(400);
    expect((await applyDelivery(c.cookie, { vehicleType: "jet" })).status).toBe(400);
    expect((await applyDelivery(c.cookie, { vehicleNumber: "" })).status).toBe(400);
    expect((await applyDelivery(c.cookie, { vehicleType: "bicycle", vehicleNumber: "" })).status).toBe(201);
  });

  it("ignores attempts to pick role, status, reviewer or applicant", async () => {
    const c = await signUp();
    const other = await signUp();
    for (const extra of [{ role: "admin" }, { status: "approved" }, { reviewedBy: other.user._id }, { user: other.user._id }]) {
      expect((await applyDelivery(c.cookie, extra)).status).toBe(400);
    }
    const ok = await applyDelivery(c.cookie);
    expect(ok.body.user).toBe(c.user._id);
  });

  it("allows only one open application per user, even concurrently", async () => {
    const c = await signUp();
    const results = await Promise.all([applyDelivery(c.cookie), applyDelivery(c.cookie), applyOwner(c.cookie)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await RoleApplication.countDocuments({})).toBe(1);
  });

  it("does not let owners, riders or admins apply", async () => {
    for (const role of ["owner", "deliveryBoy", "admin"] as const) {
      const u = await createUserWithRole(role);
      expect((await applyDelivery(u.cookie)).status).toBe(403);
    }
  });
});

describe("administrator authorization", () => {
  it("rejects anonymous, customer, owner and rider access to admin APIs", async () => {
    const c = await signUp();
    await applyDelivery(c.cookie);
    const id = String((await RoleApplication.findOne({}))?._id);
    expect((await request(app).get("/api/admin/applications")).status).toBe(401);
    expect((await act("", id, "approve")).status).toBe(401);
    for (const role of ["user", "owner", "deliveryBoy"] as const) {
      const u = await createUserWithRole(role);
      expect((await request(app).get("/api/admin/applications").set("Cookie", u.cookie)).status).toBe(403);
      expect((await act(u.cookie, id, "approve")).status).toBe(403);
      expect((await act(u.cookie, id, "reject", { reason: "nope nope" })).status).toBe(403);
    }
    expect(await roleOf(c.user._id)).toBe("user");
  });

  it("cannot be reached by a customer who edits the role in a request", async () => {
    const c = await signUp();
    const res = await request(app).get("/api/admin/applications?role=admin").set("Cookie", c.cookie);
    expect(res.status).toBe(403);
  });

  it("lists with filters, search and pagination", async () => {
    const a = await admin();
    const names = ["Alice", "Bob", "Carol"];
    for (const [i, n] of names.entries()) {
      const u = await signUp({ fullName: `${n} Test`, email: `${n.toLowerCase()}@example.com` });
      if (i === 0) await applyOwner(u.cookie);
      else await applyDelivery(u.cookie);
    }
    const all = await request(app).get("/api/admin/applications?limit=2").set("Cookie", a.cookie);
    expect(all.body.applications).toHaveLength(2);
    expect(all.body.pagination).toMatchObject({ total: 3, totalPages: 2, hasNextPage: true });
    expect(all.body.applications[0].user.email).toBeDefined();
    expect(JSON.stringify(all.body)).not.toMatch(/password/);
    const owners = await request(app).get("/api/admin/applications?role=owner").set("Cookie", a.cookie);
    expect(owners.body.pagination.total).toBe(1);
    const search = await request(app).get("/api/admin/applications?q=bob").set("Cookie", a.cookie);
    expect(search.body.applications).toHaveLength(1);
    expect((await request(app).get("/api/admin/applications?limit=500").set("Cookie", a.cookie)).status).toBe(400);
  });
});

describe("approval and provisioning", () => {
  it("approves an owner: creates the shop, grants the role, notifies, and the new owner can use owner APIs", async () => {
    const a = await admin();
    const c = await signUp();
    const id = (await applyOwner(c.cookie)).body._id;
    expect((await request(app).get("/api/order/my-orders").set("Cookie", c.cookie)).status).toBe(200); // customer view
    expect((await request(app).get("/api/shop/get-my").set("Cookie", c.cookie)).status).toBe(403); // still pending

    const res = await act(a.cookie, id, "approve");
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ status: "approved", reviewedBy: a.user._id });
    expect(await roleOf(c.user._id)).toBe("owner");
    const shop = await Shop.findOne({ owner: c.user._id }).lean();
    expect(shop).toMatchObject({ name: "Spice Garden", city: "Pune" });
    expect(shop?.location?.coordinates).toEqual([73.85, 18.52]);
    expect((await request(app).get("/api/shop/get-my").set("Cookie", c.cookie)).status).toBe(200);
    expect(await Notification.countDocuments({ user: c.user._id, type: "application_approved" })).toBe(1);
  });

  it("approves a delivery partner with a profile and unlocks rider endpoints", async () => {
    const a = await admin();
    const c = await signUp();
    const id = (await applyDelivery(c.cookie)).body._id;
    expect((await act(a.cookie, id, "approve")).status).toBe(200);
    const user = await User().findById(c.user._id).lean<{ role: string; deliveryProfile: { vehicleType: string; serviceArea: string } }>();
    expect(user?.role).toBe("deliveryBoy");
    expect(user?.deliveryProfile).toMatchObject({ vehicleType: "motorcycle", serviceArea: "Pune East" });
    expect((await request(app).get("/api/order/get-assignments").set("Cookie", c.cookie)).status).toBe(200);
  });

  it("is idempotent and safe under concurrent / repeated approvals", async () => {
    const a = await admin();
    const b = await admin();
    const c = await signUp();
    const id = (await applyOwner(c.cookie)).body._id;
    const results = await Promise.all([act(a.cookie, id, "approve"), act(b.cookie, id, "approve"), act(a.cookie, id, "approve")]);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(results.some((r) => r.status === 200)).toBe(true);
    const again = await act(a.cookie, id, "approve");
    expect(again.status).toBe(200);
    expect(again.body.alreadyApproved).toBe(true);
    expect(await Shop.countDocuments({ owner: c.user._id })).toBe(1);
    expect(await Notification.countDocuments({ user: c.user._id, type: "application_approved" })).toBe(1);
  });

  it("cannot approve and reject the same application", async () => {
    const a = await admin();
    const c = await signUp();
    const id = (await applyDelivery(c.cookie)).body._id;
    const [x, y] = await Promise.all([act(a.cookie, id, "approve"), act(a.cookie, id, "reject", { reason: "not suitable" })]);
    expect([x.status, y.status].filter((s) => s === 200)).toHaveLength(1);
    const final = await RoleApplication.findById(id);
    expect(["approved", "rejected"]).toContain(final?.status);
    expect(await roleOf(c.user._id)).toBe(final?.status === "approved" ? "deliveryBoy" : "user");
    expect((await act(a.cookie, id, final?.status === "approved" ? "reject" : "approve", { reason: "late change" })).status).toBe(409);
  });

  it("keeps the application pending and grants nothing when provisioning fails, then recovers on retry", async () => {
    const a = await admin();
    const c = await signUp();
    const id = (await applyOwner(c.cookie)).body._id;
    const spy = vi.spyOn(Shop, "findOneAndUpdate").mockRejectedValueOnce(new Error("db down"));
    const failed = await act(a.cookie, id, "approve");
    spy.mockRestore();
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain("db down");
    const stuck = await RoleApplication.findById(id);
    expect(stuck).toMatchObject({ status: "pending", provisioning: { state: "failed" } });
    expect(await roleOf(c.user._id)).toBe("user");

    expect((await act(a.cookie, id, "approve")).status).toBe(200);
    expect(await roleOf(c.user._id)).toBe("owner");
    expect(await Shop.countDocuments({ owner: c.user._id })).toBe(1);
  });

  it("recovers an abandoned (crashed) approval after the claim expires, without duplicating the shop", async () => {
    const a = await admin();
    const c = await signUp();
    const id = (await applyOwner(c.cookie)).body._id;
    await RoleApplication.updateOne({ _id: id }, { "provisioning.state": "in_progress", "provisioning.startedAt": new Date() });
    expect((await act(a.cookie, id, "approve")).body.code).toBe("REVIEW_IN_PROGRESS");
    await RoleApplication.updateOne({ _id: id }, { "provisioning.startedAt": new Date(Date.now() - 10 * 60 * 1000) });
    await Shop.create({ name: "Spice Garden", image: "x", owner: c.user._id, city: "Pune", state: "MH", address: "a" }); // half-done earlier attempt
    expect((await act(a.cookie, id, "approve")).status).toBe(200);
    expect(await Shop.countDocuments({ owner: c.user._id })).toBe(1);
  });

  it("refuses to approve if the applicant's role changed in the meantime", async () => {
    const a = await admin();
    const c = await signUp();
    const id = (await applyDelivery(c.cookie)).body._id;
    await User().updateOne({ _id: c.user._id }, { role: "owner" });
    const res = await act(a.cookie, id, "approve");
    expect(res.status).toBe(409);
    expect(await roleOf(c.user._id)).toBe("owner");
    expect((await RoleApplication.findById(id))?.status).toBe("pending");
  });
});

describe("rejection, more information and reapplying", () => {
  it("requires a reason, keeps the user a customer and shows the reason only to them and admins", async () => {
    const a = await admin();
    const c = await signUp();
    const stranger = await signUp();
    const id = (await applyOwner(c.cookie)).body._id;
    expect((await act(a.cookie, id, "reject", {})).status).toBe(400);
    expect((await act(a.cookie, id, "reject", { reason: "no" })).status).toBe(400);
    const res = await act(a.cookie, id, "reject", { reason: "Address could not be verified" });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ status: "rejected", reviewNote: "Address could not be verified", reviewedBy: a.user._id });
    expect(await roleOf(c.user._id)).toBe("user");
    expect(await Shop.countDocuments({})).toBe(0);
    expect((await request(app).get("/api/shop/get-my").set("Cookie", c.cookie)).status).toBe(403);
    expect(await Notification.countDocuments({ user: c.user._id, type: "application_rejected" })).toBe(1);

    const own = await request(app).get(`/api/applications/${id}`).set("Cookie", c.cookie);
    expect(own.body.reviewNote).toBe("Address could not be verified");
    expect((await request(app).get(`/api/applications/${id}`).set("Cookie", stranger.cookie)).status).toBe(404);
    expect((await request(app).get(`/api/applications/${id}`).set("Cookie", a.cookie)).status).toBe(200);
    const mine = await request(app).get("/api/applications/mine").set("Cookie", stranger.cookie);
    expect(mine.body).toEqual([]);
  });

  it("lets a rejected applicant apply again (a new application)", async () => {
    const a = await admin();
    const c = await signUp();
    const id = (await applyDelivery(c.cookie)).body._id;
    await act(a.cookie, id, "reject", { reason: "Vehicle details missing" });
    const again = await applyDelivery(c.cookie, { vehicleNumber: "MH14CD5678" });
    expect(again.status).toBe(201);
    expect(again.body._id).not.toBe(id);
    expect((await request(app).get("/api/applications/mine").set("Cookie", c.cookie)).body).toHaveLength(2);
  });

  it("supports request-info and resubmission, then approval", async () => {
    const a = await admin();
    const c = await signUp();
    const id = (await applyDelivery(c.cookie)).body._id;
    const asked = await act(a.cookie, id, "request-info", { reason: "Please give the full vehicle number" });
    expect(asked.body.application.status).toBe("needs_info");
    expect((await act(a.cookie, id, "approve")).status).toBe(409); // must be resubmitted first
    expect((await applyDelivery(c.cookie)).status).toBe(409); // still the one open application

    const resub = await request(app).post(`/api/applications/${id}/resubmit`).set("Cookie", c.cookie).send({ ...deliveryForm, vehicleNumber: "MH12AB9999" });
    expect(resub.status).toBe(200);
    expect(resub.body.status).toBe("pending");
    expect((await request(app).post(`/api/applications/${id}/resubmit`).set("Cookie", c.cookie).send(deliveryForm)).status).toBe(409);
    expect((await act(a.cookie, id, "approve")).status).toBe(200);
    expect((await User().findById(c.user._id).lean<{ deliveryProfile: { vehicleNumber: string } }>())?.deliveryProfile.vehicleNumber).toBe("MH12AB9999");
  });

  it("does not let someone else resubmit another user's application", async () => {
    const a = await admin();
    const c = await signUp();
    const other = await signUp();
    const id = (await applyDelivery(c.cookie)).body._id;
    await act(a.cookie, id, "request-info", { reason: "More details please" });
    expect((await request(app).post(`/api/applications/${id}/resubmit`).set("Cookie", other.cookie).send(deliveryForm)).status).toBe(404);
  });
});

describe("service-level approval and existing features", () => {
  it("approveApplication reports not found for unknown ids", async () => {
    await expect(approveApplication(String(new mongoose.Types.ObjectId()), String(new mongoose.Types.ObjectId()))).rejects.toMatchObject({ status: 404 });
  });

  it("public signup still cannot create an admin, and an old customer account is unaffected", async () => {
    const res = await signUp({ role: "admin" });
    expect(res.res.status).toBe(400);
    const ok = await signUp();
    expect(ok.user.role).toBe("user");
  });
});
