import { describe, expect, it } from "vitest";
import { isFreeMailSender, senderDomain } from "../src/config/emailSender.js";

describe("EMAIL_FROM sender check", () => {
  it("rejects free-mail senders in both address formats", () => {
    expect(isFreeMailSender("me@gmail.com")).toBe(true);
    expect(isFreeMailSender("Foodify <Me@Gmail.com>")).toBe(true);
  });
  it("accepts the Resend test sender and verified-domain senders", () => {
    expect(isFreeMailSender("Foodify <onboarding@resend.dev>")).toBe(false);
    expect(isFreeMailSender("otp@mail.foodify.in")).toBe(false);
    expect(senderDomain("Foodify <otp@foodify.in>")).toBe("foodify.in");
  });
});
