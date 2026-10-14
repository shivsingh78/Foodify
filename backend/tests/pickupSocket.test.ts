import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/mail.js", () => ({ sendOtpMail: vi.fn(async () => undefined), sendDeliveryOtpMail: vi.fn(async () => undefined) }));

import { defaultDispatchConfig } from "../src/config/dispatch.js";
import { closeSocket, initSocket } from "../src/events/socket.js";
import Notification from "../src/models/notification.model.js";
import Order from "../src/models/order.model.js";
import User from "../src/models/user.model.js";
import { runDispatchTick } from "../src/services/dispatch/dispatch.service.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

// Real Socket.IO server and an authenticated client: proves the private room, not just the emit call.
useTestDb();
let server: http.Server;
let url: string;
const open: Socket[] = [];
beforeAll(async () => {
  server = http.createServer(app);
  initSocket(server, ["http://localhost:5173"]);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  open.forEach((s) => s.close());
  await closeSocket();
  server.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clientFor = (cookie: string) => {
  const socket = connect(url, { extraHeaders: { cookie }, reconnection: false, transports: ["websocket"] });
  open.push(socket);
  const got: { event: string; payload: unknown }[] = [];
  socket.onAny((event, payload) => got.push({ event, payload }));
  return { socket, got, connected: new Promise<void>((resolve) => socket.once("connect", () => resolve())) };
};

/** Restaurant, customer and partner all at the SAME coordinates; the partner reports it the way the browser does. */
const scene = async () => {
  const { owner, shop, items } = await setupShop();
  const customer = await createUserWithRole("user");
  const rider = await createUserWithRole("deliveryBoy");
  const stranger = await createUserWithRole("deliveryBoy");
  const riderClient = clientFor(rider.cookie);
  const strangerClient = clientFor(stranger.cookie);
  await Promise.all([riderClient.connected, strangerClient.connected]);
  riderClient.socket.emit("updateLocation", { latitude: address.latitude, longitude: address.longitude });
  await sleep(300);
  const placed = await request(app)
    .post("/api/order/place-order")
    .set("Cookie", customer.cookie)
    .send({ paymentMethod: "cod", deliveryAddress: address, cartItems: [{ id: String(items[0]?._id), quantity: 1 }] });
  const orderId = placed.body._id as string;
  const status = (s: string) => request(app).post(`/api/order/update-status/${orderId}/${shop._id}`).set("Cookie", owner.cookie).send({ status: s });
  expect((await status("preparing")).status).toBe(200);
  await runDispatchTick(defaultDispatchConfig());
  await sleep(200);
  const acceptOffer = async () => {
    const offerId = (await request(app).get("/api/order/get-assignments").set("Cookie", rider.cookie)).body[0]?.offerId as string;
    expect(offerId).toBeTruthy();
    return request(app).post(`/api/order/accept-order/${offerId}`).set("Cookie", rider.cookie);
  };
  return { rider, riderClient, strangerClient, stranger, orderId, status, acceptOffer };
};
const names = (c: { got: { event: string }[] }) => c.got.map((g) => g.event);

describe("real socket delivery of the ready-for-pickup notice (same location for everyone)", () => {
  it("same-location partner is online, eligible and offered the order", async () => {
    const s = await scene();
    expect(await User.findById(s.rider.user._id).select("isOnline").lean()).toMatchObject({ isOnline: true });
    expect(names(s.riderClient)).toContain("newAssignment");
    expect(names(s.strangerClient)).not.toContain("newAssignment");
  });

  it("accepted before 'out of delivery': the partner's client receives the event and the notification, nobody else does", async () => {
    const s = await scene();
    expect((await s.acceptOffer()).status).toBe(200);
    s.riderClient.got.length = 0;
    expect((await s.status("out of delivery")).status).toBe(200);
    await sleep(300);
    expect(names(s.riderClient)).toEqual(expect.arrayContaining(["notification", "deliveryReadyForPickup"]));
    expect(names(s.riderClient).filter((e) => e === "deliveryReadyForPickup")).toHaveLength(1);
    expect(names(s.strangerClient)).not.toContain("deliveryReadyForPickup");
    expect(await Notification.countDocuments({ user: s.rider.user._id, title: "Order ready for pickup" })).toBe(1);
  });

  it("'out of delivery' pressed before accepting: the partner is told as soon as they accept (the live failure)", async () => {
    const s = await scene();
    expect((await s.status("out of delivery")).status).toBe(200);
    await sleep(200);
    expect(names(s.riderClient)).not.toContain("deliveryReadyForPickup");
    expect((await Order.findById(s.orderId))!.shopOrders[0]!.assignedDeliveryBoy).toBeFalsy();

    s.riderClient.got.length = 0;
    expect((await s.acceptOffer()).status).toBe(200);
    await sleep(300);
    expect(names(s.riderClient)).toEqual(expect.arrayContaining(["notification", "deliveryReadyForPickup"]));
    expect(await Notification.countDocuments({ user: s.rider.user._id, title: "Order ready for pickup" })).toBe(1);
    expect(names(s.strangerClient)).not.toContain("deliveryReadyForPickup");
  });
});
