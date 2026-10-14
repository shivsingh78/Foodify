import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSocket, emitToUser, initSocket } from "../src/events/socket.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();

let server: http.Server;
let url: string;
const open: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(app);
  initSocket(server, ["http://localhost:5173"]);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  open.forEach((s) => s.close());
  await closeSocket();
  server.close();
});

const connectAs = (cookie?: string) => {
  const socket = connect(url, { extraHeaders: cookie ? { cookie } : {}, reconnection: false, transports: ["websocket"] });
  open.push(socket);
  return socket;
};
const once = <T>(socket: Socket, event: string) => new Promise<T>((resolve) => socket.once(event, resolve));

describe("socket security", () => {
  it("rejects unauthenticated connections", async () => {
    const socket = connectAs();
    const err = await once<Error>(socket, "connect_error");
    expect(err.message).toBe("Authentication required");
  });

  it("delivers events only to the addressed user's room", async () => {
    const a = await createUserWithRole("user");
    const b = await createUserWithRole("user");
    const sa = connectAs(a.cookie);
    const sb = connectAs(b.cookie);
    await Promise.all([once(sa, "connect"), once(sb, "connect")]);

    let leaked = false;
    sb.on("private", () => (leaked = true));
    const received = once<{ n: number }>(sa, "private");
    emitToUser(a.user._id, "private", { n: 1 });
    expect(await received).toEqual({ n: 1 });
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toBe(false);
  });
});

describe("socket room authorization", () => {
  it("ignores client attempts to join other users' rooms or subscribe to orders", async () => {
    const a = await createUserWithRole("user");
    const b = await createUserWithRole("user");
    const sb = connectAs(b.cookie);
    await once(sb, "connect");
    let leaked = false;
    sb.on("etaUpdated", () => (leaked = true));
    sb.emit("join", `user:${a.user._id}`);
    sb.emit("subscribe", { orderId: "x", room: `user:${a.user._id}` });
    sb.emit("joinRoom", `user:${a.user._id}`);
    await new Promise((r) => setTimeout(r, 100));
    emitToUser(a.user._id, "etaUpdated", { secret: true });
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toBe(false);
  });
});
