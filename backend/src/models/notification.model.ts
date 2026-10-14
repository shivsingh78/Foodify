import mongoose, { type HydratedDocument, type Types } from "mongoose";
import { NOTIFICATION_TYPES, type NotificationType } from "@foodify/validation";

export interface INotification {
  user: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  data: { orderId?: Types.ObjectId; shopOrderId?: Types.ObjectId };
  /** Optional idempotency key: the same (user, dedupeKey) is stored only once, so retries cannot duplicate a notification. */
  dedupeKey?: string;
  read: boolean;
  readAt?: Date | null;
  createdAt: Date;
}

export type NotificationDocument = HydratedDocument<INotification>;

const notificationSchema = new mongoose.Schema<INotification>(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: {
      orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
      shopOrderId: { type: mongoose.Schema.Types.ObjectId },
    },
    dedupeKey: { type: String },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });

const Notification = mongoose.model<INotification>("Notification", notificationSchema);

export default Notification;
