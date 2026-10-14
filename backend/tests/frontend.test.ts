import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPublicConfig, renderRuntimeConfig } from "../src/config/publicConfig.js";
import { createApp } from "../src/app.js";
import { closeSocket, initSocket } from "../src/events/socket.js";

const dir = mkdtempSync(path.join(tmpdir(), "foodify-spa-"));
mkdirSync(path.join(dir, "assets"));
writeFileSync(path.join(dir, "index.html"), "<!doctype html><div id=root>SPA</div>");
writeFileSync(path.join(dir, "assets", "app-abc.js"), "console.log(1)");

const spa = createApp({ frontendDir: dir });
const apiOnly = createApp({ frontendDir: path.join(dir, "missing") });

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("frontend static serving", () => {
  it("serves index.html at / and for client-side routes", async () => {
    for (const route of ["/", "/signin", "/track-order/123"]) {
      const res = await request(spa).get(route).set("Accept", "text/html");
      expect(res.status).toBe(200);
      expect(res.text).toContain("SPA");
    }
  });

  it("serves hashed assets with long-lived caching", async () => {
    const res = await request(spa).get("/assets/app-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("returns 404 for missing files instead of index.html", async () => {
    const res = await request(spa).get("/assets/missing.js").set("Accept", "text/html");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("SPA");
  });

  it("keeps /api working and returns JSON 404 for unknown API paths", async () => {
    expect((await request(spa).get("/api/health")).status).toBe(200);
    for (const route of ["/api/nope", "/api/auth/nope", "/api"]) {
      const res = await request(spa).get(route).set("Accept", "text/html");
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toContain("application/json");
    }
    expect((await request(spa).post("/api/nope")).status).toBe(404);
  });

  it("does not serve the SPA for non-GET requests or non-HTML clients", async () => {
    expect((await request(spa).post("/signin")).status).toBe(404);
    expect((await request(spa).get("/signin").set("Accept", "application/json")).status).toBe(404);
  });

  it("allows popups (Firebase sign-in) and applies the SPA CSP in report-only mode by default", async () => {
    const res = await request(spa).get("/");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    expect(res.headers["content-security-policy-report-only"]).toContain("https://checkout.razorpay.com");
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("keeps helmet's strict default CSP on API responses", async () => {
    const res = await request(spa).get("/api/health");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).not.toContain("razorpay");
  });

  it("serves allowlisted runtime config as no-store JavaScript", async () => {
    const res = await request(spa).get("/runtime-config.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/javascript");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toMatch(/^window\.__FOODIFY_CONFIG__ = Object\.freeze\(\{.*\}\);\n$/);
  });

  it("does not leak secrets or arbitrary env vars through runtime config", async () => {
    const res = await request(spa).get("/runtime-config.js");
    for (const secret of [
      process.env.JWT_SECRET,
      process.env.MONGODB_URL,
      process.env.RAZORPAY_KEY_SECRET,
      process.env.GEOAPIFY_API_KEY,
    ]) {
      expect(secret).toBeTruthy();
      expect(res.text).not.toContain(secret as string);
    }
    expect(res.text).not.toMatch(/JWT|MONGODB|SECRET|PRIVATE|RESEND|CLOUDINARY/i);
  });

  it("stays API-only when there is no frontend build", async () => {
    expect((await request(apiOnly).get("/")).status).toBe(404);
    expect((await request(apiOnly).get("/api/health")).status).toBe(200);
  });
});

describe("Socket.IO next to the SPA", () => {
  let server: http.Server;
  beforeAll(async () => {
    server = http.createServer(spa);
    initSocket(server, []);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });
  afterAll(async () => {
    await closeSocket();
    server.close();
  });

  it("handles /socket.io before the SPA fallback (handshake reaches the auth middleware)", async () => {
    const url = `http://localhost:${(server.address() as AddressInfo).port}`;
    const socket = connect(url, { reconnection: false, transports: ["websocket"] });
    const err = await new Promise<Error>((resolve) => socket.once("connect_error", resolve));
    socket.close();
    expect(err.message).toBe("Authentication required");
    const polling = await request(server).get("/socket.io/?EIO=4&transport=polling").set("Accept", "text/html");
    expect(polling.text).not.toContain("SPA");
  });
});

describe("public runtime config builder", () => {
  const base = {
    VITE_FIREBASE_APIKEY: undefined,
    VITE_FIREBASE_PROJECT_ID: undefined,
    VITE_FIREBASE_AUTH_DOMAIN: undefined,
    VITE_RAZORPAY_KEY_ID: undefined,
    FIREBASE_PROJECT_ID: undefined,
    RAZORPAY_KEY_ID: undefined,
  };

  it("emits only the four allowlisted keys, omitting unset ones", () => {
    const cfg = buildPublicConfig({
      ...base,
      VITE_FIREBASE_APIKEY: "web-key",
      FIREBASE_PROJECT_ID: "proj",
      RAZORPAY_KEY_ID: "rzp_live_x",
      // extra server-only fields must be ignored even if passed in
      ...({ JWT_SECRET: "s", FIREBASE_PRIVATE_KEY: "pk" } as object),
    });
    expect(cfg).toEqual({ VITE_FIREBASE_APIKEY: "web-key", VITE_FIREBASE_PROJECT_ID: "proj", VITE_RAZORPAY_KEY_ID: "rzp_live_x" });
  });

  it("serializes safely for embedding in a script", () => {
    const js = renderRuntimeConfig({ VITE_FIREBASE_AUTH_DOMAIN: "</script><script>alert(1)</script>\u2028" });
    expect(js).not.toContain("</script>");
    expect(js).not.toContain("\u2028");
  });
});
