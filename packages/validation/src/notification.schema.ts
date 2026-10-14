import { z } from "zod";
import { paginationSchema } from "./pagination.schema.js";

export const NOTIFICATION_TYPES = [
  "order_placed",
  "order_status",
  "payment_confirmed",
  "delivery_assigned",
  "order_delivered",
  "application_submitted",
  "application_approved",
  "application_rejected",
  "application_needs_info",
  "order_delayed",
  "incident_escalated",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationListQuerySchema = paginationSchema.extend({
  unreadOnly: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
