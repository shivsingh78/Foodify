import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resendMock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: resendMock.send }; } }));

import { env } from "../src/config/env.js";
import Order from "../src/models/order.model.js";
import User from "../src/models/user.model.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, signUp, useTestDb } from "./helpers.js";

useTestDb();

// mail.ts reads `env` at call time, so tests configure it by mutating the parsed env object.
const importMail = async (config: { key?: string; from?: string } = { key: "re_test_key_123", from: "Foodify <otp@example.com>" }) => {
  env.RESEND_API_KEY = config.key || undefined;
  env.EMAIL_FROM = config.from || undefined;
  return import("../src/utils/mail.js");
};
beforeEach(() => {
  resendMock.send.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("mail service (Resend, mocked provider)", () => {
  it("succeeds only when Resend accepts the request, with the configured sender", async () => {
    resendMock.send.mockResolvedValue({ data: { id: "email_1" }, error: null });
    const { sendDeliveryOtpMail } = await importMail();
    await expect(sendDeliveryOtpMail("c@example.com", "4321")).resolves.toBeUndefined();
    expect(resendMock.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Foodify <otp@example.com>", to: "c@example.com", subject: "Delivery OTP", html: expect.stringContaining("4321") }),
    );
  });

  it("fails safely for an invalid key or any provider rejection, without leaking details", async () => {
    resendMock.send.mockResolvedValue({ data: null, error: { name: "invalid_api_key", statusCode: 401, message: "API key is invalid re_secret" } });
    const { sendOtpMail } = await importMail();
    const err = await sendOtpMail("c@example.com", "123456").catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: "EMAIL_FAILED" });
    expect(err.message).not.toMatch(/key|re_secret|resend/i);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toMatch(/re_secret|re_test_key|123456|c@example.com/);
  });

  it("recognises Resend's 403 sender/domain restriction: operator hint in logs, generic message to the client", async () => {
    resendMock.send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: "You can only send testing emails to your own email address (owner@example.com)." },
    });
    const { sendDeliveryOtpMail } = await importMail({ key: "re_test_key_123", from: "Foodify <onboarding@resend.dev>" });
    const err = await sendDeliveryOtpMail("customer@example.com", "4321").catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: "EMAIL_SENDER_NOT_ALLOWED" });
    expect(err.message).not.toMatch(/resend|domain|owner@example|re_test/i);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).toMatch(/verify a domain/);
    expect(logged).not.toMatch(/4321|customer@example.com|owner@example.com|re_test_key/);
    expect(resendMock.send).toHaveBeenCalledTimes(1); // no silent retry to another recipient
  });

  it("treats a response without a message id as a failure", async () => {
    resendMock.send.mockResolvedValue({ data: {}, error: null });
    const { sendOtpMail } = await importMail();
    await expect(sendOtpMail("c@example.com", "123456")).rejects.toMatchObject({ code: "EMAIL_FAILED" });
  });

  it("maps network failures and timeouts to a generic 502", async () => {
    const { sendOtpMail } = await importMail();
    resendMock.send.mockRejectedValue(new Error("ECONNRESET with re_test_key_123"));
    const net = await sendOtpMail("c@example.com", "123456").catch((e) => e);
    expect(net).toMatchObject({ status: 502, code: "EMAIL_FAILED" });
    expect(net.message).not.toMatch(/ECONNRESET|re_test/);

    vi.useFakeTimers();
    resendMock.send.mockReturnValue(new Promise(() => undefined));
    const pending = sendOtpMail("c@example.com", "123456").catch((e) => e);
    await vi.advanceTimersByTimeAsync(9000);
    expect(await pending).toMatchObject({ status: 502, code: "EMAIL_FAILED" });
    vi.useRealTimers();
  });

  it("answers 503 and never calls the provider when email is not configured", async () => {
    const { sendOtpMail } = await importMail({});
    await expect(sendOtpMail("c@example.com", "123456")).rejects.toMatchObject({ status: 503, code: "EMAIL_NOT_CONFIGURED" });
    expect(resendMock.send).not.toHaveBeenCalled();
  });
});

describe("OTP state when delivery fails (real services, provider mocked)", () => {
  const rejected = { data: null, error: { name: "invalid_api_key", statusCode: 401, message: "x" } };

  it("delivery OTP: unsent OTP is invalidated and the partner can retry at once", async () => {
    await importMail();
    const freshApp = app;
    const Order2 = Order;
    const { owner, shop: s, items } = await setupShop();
    const customer = await createUserWithRole("user");
    const boy = await createUserWithRole("deliveryBoy");
    const order = await Order2.create({
      user: customer.user._id, paymentMethod: "cod", deliveryAddress: address, totalAmount: 1,
      shopOrders: [{ shop: s._id, owner: owner.user._id, subtotal: 1, status: "out of delivery", assignedDeliveryBoy: boy.user._id, shopOrderItems: [{ item: items[0]?._id, name: "x", price: 1, quantity: 1 }] }],
    });
    const shopOrderId = String(order.shopOrders[0]?._id);
    const send = () => request(freshApp).post("/api/order/send-delivery-otp").set("Cookie", boy.cookie).send({ orderId: String(order._id), shopOrderId });

    resendMock.send.mockResolvedValue(rejected);
    const failed = await send();
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toMatch(/resend|invalid_api_key|re_test/);
    const after = await Order2.findById(order._id).select("+shopOrders.deliveryOtp +shopOrders.otpExpires");
    expect(after?.shopOrders[0]?.deliveryOtp).toBeNull();
    expect(after?.shopOrders[0]?.otpExpires).toBeNull();

    // No OTP can be verified, and an immediate retry (no 30 s cooldown) succeeds.
    const verify = await request(freshApp).post("/api/order/verify-delivery-otp").set("Cookie", boy.cookie).send({ orderId: String(order._id), shopOrderId, otp: "0000" });
    expect(verify.status).toBe(400);
    resendMock.send.mockResolvedValue({ data: { id: "e1" }, error: null });
    expect((await send()).status).toBe(200);
    const stored = await Order2.findById(order._id).select("+shopOrders.deliveryOtp");
    expect(stored?.shopOrders[0]?.deliveryOtp).toMatch(/^[a-f0-9]{64}$/);
    // The cooldown still applies after a SUCCESSFUL send.
    expect((await send()).status).toBe(429);
  });

  it("delivery OTP endpoint: a 403 from the provider is a failed delivery, not a sent OTP", async () => {
    await importMail({ key: "re_test_key_123", from: "Foodify <onboarding@resend.dev>" });
    const { owner, shop: s, items } = await setupShop();
    const customer = await createUserWithRole("user");
    const boy = await createUserWithRole("deliveryBoy");
    const order = await Order.create({
      user: customer.user._id, paymentMethod: "cod", deliveryAddress: address, totalAmount: 1,
      shopOrders: [{ shop: s._id, owner: owner.user._id, subtotal: 1, status: "out of delivery", assignedDeliveryBoy: boy.user._id, shopOrderItems: [{ item: items[0]?._id, name: "x", price: 1, quantity: 1 }] }],
    });
    resendMock.send.mockResolvedValue({ data: null, error: { name: "validation_error", statusCode: 403, message: "testing emails only" } });
    const res = await request(app).post("/api/order/send-delivery-otp").set("Cookie", boy.cookie)
      .send({ orderId: String(order._id), shopOrderId: String(order.shopOrders[0]?._id) });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("EMAIL_SENDER_NOT_ALLOWED");
    const stored = await Order.findById(order._id).select("+shopOrders.deliveryOtp");
    expect(stored?.shopOrders[0]?.deliveryOtp).toBeNull();
  });

  it("password reset OTP: failure leaves no valid OTP and allows a retry", async () => {
    await importMail();
    const freshApp = app;
    const { body } = await signUp();
    resendMock.send.mockResolvedValue(rejected);
    expect((await request(freshApp).post("/api/auth/send-otp").send({ email: body.email })).status).toBe(502);
    const u = await User.findOne({ email: body.email }).select("+resetOtp +otpExpires +otpLastSentAt");
    expect(u?.resetOtp).toBeNull();
    expect(u?.otpLastSentAt).toBeNull();

    resendMock.send.mockResolvedValue({ data: { id: "e2" }, error: null });
    expect((await request(freshApp).post("/api/auth/send-otp").send({ email: body.email })).status).toBe(200);
    const sent = JSON.stringify(resendMock.send.mock.calls.at(-1));
    expect(sent).toMatch(/\d{6}/);
  });
});
