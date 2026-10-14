import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { latitudeSchema, longitudeSchema } from "@foodify/validation";
import DeliveryAssignment from "../models/deliveryAssignment.model.js";
import Order from "../models/order.model.js";
import User, { type UserRole } from "../models/user.model.js";
import { refreshEtaOnPartnerMove } from "../services/dispatch/dispatch.service.js";
import { verifyToken } from "../utils/token.js";

type SocketData = { userId: string; role: UserRole };

let io: Server | null = null;

export const userRoom = (userId: string): string => `user:${userId}`;

const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
};

/**
 * Sends an event to every connected socket of one user. A no-op when the
 * socket server is not running or the user is offline: the database is the
 * source of truth and clients refetch after reconnecting.
 */
export const emitToUser = (userId: string, event: string, payload: unknown): number => {
  io?.to(userRoom(userId)).emit(event, payload);
  // How many live sockets were in the private room (0 = the user is offline or not joined): lets callers tell a
  // missed live event from a missing persisted notification. Never includes payload data.
  return io?.sockets.adapter.rooms.get(userRoom(userId))?.size ?? 0;
};

const LOCATION_MIN_INTERVAL_MS = 2000;

const handleLocationUpdate = async (socket: Socket, payload: unknown, lastSentAt: { value: number }) => {
  const data = socket.data as SocketData;

  const now = Date.now();
  if (now - lastSentAt.value < LOCATION_MIN_INTERVAL_MS) return;
  lastSentAt.value = now;

  const { latitude, longitude } = (payload ?? {}) as Record<string, unknown>;
  const lat = latitudeSchema.safeParse(latitude);
  const lon = longitudeSchema.safeParse(longitude);
  if (!lat.success || !lon.success) return;

  // The role is checked against the database on every update: a socket opened before approval
  // (or after a demotion) must not be able to publish rider locations.
  const updated = await User.updateOne(
    { _id: data.userId, role: "deliveryBoy" },
    { location: { type: "Point", coordinates: [lon.data, lat.data] }, locationUpdatedAt: new Date(), isOnline: true },
  );
  if (updated.matchedCount !== 1) return;
  void refreshEtaOnPartnerMove(data.userId, [lon.data, lat.data]).catch(() => undefined);

  // Only the customers of orders this partner is currently delivering may see the position.
  const assignments = await DeliveryAssignment.find({ assignedTo: data.userId, status: "assigned" })
    .select("order")
    .lean();
  if (assignments.length === 0) return;
  const orders = await Order.find({ _id: { $in: assignments.map((a) => a.order) } })
    .select("user")
    .lean();
  for (const order of orders) {
    emitToUser(order.user.toString(), "updateDeliveryLocation", {
      deliveryBoyId: data.userId,
      latitude: lat.data,
      longitude: lon.data,
    });
  }
};

export const initSocket = (server: HttpServer, allowedOrigins: string[]): Server => {
  io = new Server(server, {
    cors: { origin: allowedOrigins, credentials: true, methods: ["GET", "POST"] },
  });

  // Authenticate the handshake from the httpOnly session cookie; identity is never client-supplied.
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, "token");
      if (!token) return next(new Error("Authentication required"));
      const payload = verifyToken(token);
      if (payload.purpose) return next(new Error("Authentication required"));
      const user = await User.findById(payload.userId).select("role").lean();
      if (!user) return next(new Error("Authentication required"));
      (socket.data as SocketData) = { userId: payload.userId, role: user.role };
      next();
    } catch {
      next(new Error("Authentication required"));
    }
  });

  io.on("connection", (socket) => {
    const { userId } = socket.data as SocketData;
    void socket.join(userRoom(userId));
    void User.updateOne({ _id: userId }, { isOnline: true }).catch(() => undefined);

    const lastSentAt = { value: 0 };
    socket.on("updateLocation", (payload: unknown) => {
      handleLocationUpdate(socket, payload, lastSentAt).catch((error: unknown) =>
        console.error("updateLocation failed:", error instanceof Error ? error.message : error),
      );
    });

    socket.on("disconnect", () => {
      // Only mark offline when the user's last connection closes.
      const remaining = io?.sockets.adapter.rooms.get(userRoom(userId))?.size ?? 0;
      if (remaining === 0) {
        void User.updateOne({ _id: userId }, { isOnline: false }).catch(() => undefined);
      }
    });
  });

  return io;
};

export const closeSocket = async (): Promise<void> => {
  if (io) {
    await io.close();
    io = null;
  }
};
