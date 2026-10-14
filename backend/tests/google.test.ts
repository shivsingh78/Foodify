import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdToken = vi.hoisted(() => vi.fn());
vi.mock("../src/config/firebase.js", () => ({ getFirebaseAuth: () => ({ verifyIdToken }) }));

import { app, signUp, useTestDb } from "./helpers.js";

useTestDb();
beforeEach(() => {
  verifyIdToken.mockReset();
});

const verified = (over: Record<string, unknown> = {}) =>
  verifyIdToken.mockResolvedValue({ uid: "uid-1", email: "Person@Example.com", email_verified: true, name: "Person", ...over });

const googleAuth = (body: Record<string, unknown> = {}, path = "google-signin") =>
  request(app).post(`/api/auth/${path}`).send({ idToken: "good-token", ...body });
const User = () => mongoose.model("User");

describe("Google authentication with Firebase ID-token verification", () => {
  it("creates a customer account for a new verified identity and logs them in immediately", async () => {
    verified({ picture: "https://example.com/p.jpg" });
    const res = await googleAuth();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "person@example.com", fullName: "Person", role: "user", profileImage: "https://example.com/p.jpg" });
    expect(res.body.googleUid).toBeUndefined();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^token=/);
    expect(verifyIdToken).toHaveBeenCalledWith("good-token", true);

    const session = await request(app).get("/api/user/current").set("Cookie", String(res.headers["set-cookie"]?.[0]).split(";")[0]);
    expect(session.status).toBe(200);
  });

  it("signs in the existing account on the next attempt without duplicating it", async () => {
    verified();
    expect((await googleAuth()).status).toBe(201);
    expect((await googleAuth()).status).toBe(200);
    expect((await googleAuth({}, "google-signup")).status).toBe(200); // sign-up button behaves the same
    expect(await User().countDocuments({})).toBe(1);
  });

  it("never takes role, email or name from the request", async () => {
    verified();
    expect((await googleAuth({ role: "owner" })).status).toBe(400);
    expect((await googleAuth({ email: "evil@example.com" })).status).toBe(400);
    const ok = await googleAuth({ mobile: "9876543210" });
    expect(ok.body).toMatchObject({ role: "user", email: "person@example.com", mobile: "9876543210" });
  });

  it("creates only one account for concurrent first sign-ins", async () => {
    verified();
    const results = await Promise.all(Array.from({ length: 8 }, () => googleAuth()));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await User().countDocuments({})).toBe(1);
    expect(new Set(results.map((r) => r.body._id)).size).toBe(1);
  });

  it("does not silently merge into an existing password account", async () => {
    verified();
    await signUp({ email: "person@example.com" });
    const res = await googleAuth();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACCOUNT_EXISTS_WITH_PASSWORD");
    expect(res.headers["set-cookie"]).toBeUndefined();
    const stored = await User().findOne({ email: "person@example.com" }).select("+googleUid").lean<{ googleUid?: string }>();
    expect(stored?.googleUid).toBeUndefined();
  });

  it("links a legacy password-less account to the verified Google identity", async () => {
    verified();
    await User().create({ fullName: "Old", email: "person@example.com", mobile: "9876543210", role: "user" });
    const res = await googleAuth();
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe("Old");
    expect(await User().countDocuments({})).toBe(1);
  });

  it("rejects a different Google identity for an already-linked email", async () => {
    verified();
    await googleAuth();
    verified({ uid: "someone-else" });
    expect((await googleAuth()).status).toBe(401);
  });

  it("finds the account by Firebase UID even if the Google email changed", async () => {
    verified();
    await googleAuth();
    verified({ email: "renamed@example.com" });
    const res = await googleAuth();
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("person@example.com");
  });

  it("reports genuine failures with clear errors and creates nothing", async () => {
    const fail = (code?: string) =>
      verifyIdToken.mockImplementation(async () => {
        throw Object.assign(new Error("x"), { code });
      });
    fail();
    expect((await googleAuth()).status).toBe(401);
    fail("auth/user-disabled");
    const disabled = await googleAuth();
    expect(disabled.status).toBe(403);
    expect(disabled.body.code).toBe("ACCOUNT_DISABLED");
    fail("auth/id-token-expired");
    expect((await googleAuth()).body.code).toBe("FIREBASE_TOKEN_EXPIRED");
    verified({ email_verified: false });
    expect((await googleAuth()).status).toBe(403);
    verified({ email: undefined });
    expect((await googleAuth()).status).toBe(400);
    expect(await User().countDocuments({})).toBe(0);
  });
});
