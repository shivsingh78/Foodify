import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/utils/crypto.js";
import { app, signUp, useTestDb } from "./helpers.js";

vi.mock("../src/utils/mail.js", () => ({
  sendOtpMail: vi.fn(async () => undefined),
  sendDeliveryOtpMail: vi.fn(async () => undefined),
}));

useTestDb();
const User = () => mongoose.model("User");

describe("signup", () => {
  it("creates a customer and never exposes the password hash", async () => {
    const { res } = await signUp();
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("user");
    expect(res.body.password).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects attempts to choose a privileged role", async () => {
    const { res } = await signUp({ role: "owner" });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate emails", async () => {
    const first = await signUp();
    const second = await signUp({ email: first.body.email });
    expect(second.res.status).toBe(409);
  });
});

describe("signin", () => {
  it("logs in with correct credentials", async () => {
    const { body } = await signUp();
    const res = await request(app).post("/api/auth/signin").send({ email: body.email, password: body.password });
    expect(res.status).toBe(200);
    expect(res.body.password).toBeUndefined();
  });

  it("uses the same generic error for wrong password and unknown email", async () => {
    const { body } = await signUp();
    const wrong = await request(app).post("/api/auth/signin").send({ email: body.email, password: "wrong-password" });
    const unknown = await request(app).post("/api/auth/signin").send({ email: "nobody@example.com", password: "whatever1" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it("does not allow password login for an account without a local password", async () => {
    await User().create({ fullName: "G", email: "g@example.com", mobile: "9876543210", role: "user" });
    const res = await request(app).post("/api/auth/signin").send({ email: "g@example.com", password: "anything1" });
    expect(res.status).toBe(401);
  });
});

describe("session tokens", () => {
  it("rejects requests without a cookie and with a password-reset token used as a session", async () => {
    expect((await request(app).get("/api/user/current")).status).toBe(401);

    const { signPurposeToken } = await import("../src/utils/token.js");
    const { user } = await signUp();
    const { token } = signPurposeToken(user._id, "password_reset", "5m");
    const res = await request(app).get("/api/user/current").set("Cookie", `token=${token}`);
    expect(res.status).toBe(401);
  });

  it("returns the current user without secrets", async () => {
    const { cookie } = await signUp();
    const res = await request(app).get("/api/user/current").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.password).toBeUndefined();
    expect(res.body.resetOtp).toBeUndefined();
  });
});

describe("password reset", () => {
  const plantOtp = async (email: string, otp: string, extra: Record<string, unknown> = {}) =>
    User().updateOne(
      { email },
      { resetOtp: sha256(otp), otpExpires: new Date(Date.now() + 60_000), otpAttempts: 0, ...extra },
    );

  it("gives the same response for unknown and known emails (no enumeration)", async () => {
    const { body } = await signUp();
    const known = await request(app).post("/api/auth/send-otp").send({ email: body.email });
    const unknown = await request(app).post("/api/auth/send-otp").send({ email: "ghost@example.com" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });

  it("stores only a hash of the OTP", async () => {
    const { body } = await signUp();
    await request(app).post("/api/auth/send-otp").send({ email: body.email });
    const user = await User().findOne({ email: body.email }).select("+resetOtp").lean<{ resetOtp: string }>();
    expect(user?.resetOtp).toMatch(/^[a-f0-9]{64}$/);
  });

  it("runs the full flow and the reset token cannot be reused", async () => {
    const { body } = await signUp();
    await plantOtp(body.email, "123456");

    const verified = await request(app).post("/api/auth/verify-otp").send({ email: body.email, otp: "123456" });
    expect(verified.status).toBe(200);
    const { resetToken } = verified.body;

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: body.email, newPassword: "brand-new-pass", resetToken });
    expect(reset.status).toBe(200);

    const reuse = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: body.email, newPassword: "another-pass-1", resetToken });
    expect(reuse.status).toBe(401);

    const login = await request(app).post("/api/auth/signin").send({ email: body.email, password: "brand-new-pass" });
    expect(login.status).toBe(200);
  });

  it("does not accept an OTP twice", async () => {
    const { body } = await signUp();
    await plantOtp(body.email, "654321");
    expect((await request(app).post("/api/auth/verify-otp").send({ email: body.email, otp: "654321" })).status).toBe(200);
    expect((await request(app).post("/api/auth/verify-otp").send({ email: body.email, otp: "654321" })).status).toBe(400);
  });

  it("rejects an expired OTP", async () => {
    const { body } = await signUp();
    await plantOtp(body.email, "111111", { otpExpires: new Date(Date.now() - 1000) });
    const res = await request(app).post("/api/auth/verify-otp").send({ email: body.email, otp: "111111" });
    expect(res.status).toBe(400);
  });

  it("locks the OTP after too many wrong guesses", async () => {
    const { body } = await signUp();
    await plantOtp(body.email, "222222");
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/verify-otp").send({ email: body.email, otp: "000000" });
    }
    const res = await request(app).post("/api/auth/verify-otp").send({ email: body.email, otp: "222222" });
    expect(res.status).toBe(400);
  });

  it("refuses a reset token that was never issued by OTP verification", async () => {
    const { body, user } = await signUp();
    const { signPurposeToken } = await import("../src/utils/token.js");
    const { token } = signPurposeToken(user._id, "password_reset", "5m");
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: body.email, newPassword: "hacked-pass-1", resetToken: token });
    expect(res.status).toBe(401);
  });
});

describe("google auth", () => {
  it("fails explicitly when Firebase is not configured instead of trusting the client", async () => {
    const signup = await request(app).post("/api/auth/google-signup").send({ idToken: "fake", mobile: "9876543210" });
    expect(signup.status).toBe(503);
    const signin = await request(app).post("/api/auth/google-signin").send({ idToken: "fake" });
    expect(signin.status).toBe(503);
  });

  it("no longer accepts a bare email or a role", async () => {
    expect((await request(app).post("/api/auth/google-signin").send({ email: "a@b.com" })).status).toBe(400);
    const res = await request(app)
      .post("/api/auth/google-signup")
      .send({ idToken: "x", mobile: "9876543210", role: "owner" });
    expect(res.status).toBe(400);
  });
});
