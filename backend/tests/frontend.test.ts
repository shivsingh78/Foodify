import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("allows popups (Firebase sign-in) and does not apply a blocking CSP to the SPA", async () => {
    const res = await request(spa).get("/");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    expect(res.headers["content-security-policy"]).toBeUndefined();
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
