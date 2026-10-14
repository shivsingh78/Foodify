import { buildPaginationMeta, type NotificationType } from "@foodify/validation";
import { Types } from "mongoose";
import { emitToUser } from "../events/socket.js";
import Notification from "../models/notification.model.js";
import { AppError } from "../utils/AppError.js";

type NotifyInput = {
  userId: string | Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  orderId?: string | Types.ObjectId;
  shopOrderId?: string | Types.ObjectId;
  /** Makes the call idempotent: a second notify() with the same key for the same user is a no-op. */
  dedupeKey?: string;
};

/**
 * Persists an in-app notification and pushes it to the recipient if connected.
 * Failures are logged and swallowed: a notification problem must never roll
 * back or fail the order/payment operation that triggered it.
 */
/** Result of notify(): `duplicate` means a notification with the same dedupeKey already exists. */
export type NotifyResult = "created" | "duplicate" | "failed";

export const notify = async (input: NotifyInput): Promise<NotifyResult> => {
  try {
    const doc = await Notification.create({
      user: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      data: { orderId: input.orderId, shopOrderId: input.shopOrderId },
      ...(input.dedupeKey && { dedupeKey: input.dedupeKey }),
    });
    emitToUser(input.userId.toString(), "notification", doc.toJSON());
    return "created";
  } catch (error) {
    if (input.dedupeKey && typeof error === "object" && error !== null && "code" in error && error.code === 11000) return "duplicate"; // already sent
    console.error("notify failed:", error instanceof Error ? error.message : error);
    return "failed";
  }
};

export const listNotifications = async (
  userId: string,
  { page, limit, unreadOnly }: { page: number; limit: number; unreadOnly?: boolean },
) => {
  const filter = { user: userId, ...(unreadOnly && { read: false }) };
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: userId, read: false }),
  ]);
  return { notifications, unreadCount, pagination: buildPaginationMeta(page, limit, total) };
};

/** Scoped by recipient: another user's notification id resolves to "not found". */
export const markNotificationRead = async (userId: string, notificationId: string) => {
  const updated = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { read: true, readAt: new Date() },
    { new: true },
  ).lean();
  if (!updated) throw AppError.notFound("Notification not found");
  return updated;
};

export const markAllNotificationsRead = async (userId: string) => {
  const result = await Notification.updateMany(
    { user: userId, read: false },
    { read: true, readAt: new Date() },
  );
  return { updated: result.modifiedCount };
};
