import { z } from "zod";
import { latitudeSchema, longitudeSchema, objectIdSchema } from "./common.schema.js";
import { paginationSchema } from "./pagination.schema.js";

export const PAYMENT_METHODS = ["cod", "online"] as const;

/**
 * Order lifecycle of one shop order. `delivered` is not reachable through
 * the status endpoint: it is only set by successful delivery-OTP verification.
 */
export const ORDER_STATUSES = [
  "pending",
  "preparing",
  "out of delivery",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Clients send only ids and quantities; prices always come from the database. */
export const placeOrderSchema = z.strictObject({
  paymentMethod: z.enum(PAYMENT_METHODS),
  deliveryAddress: z.strictObject({
    text: z.string().trim().min(1, "Delivery address is required").max(300),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
  }),
  cartItems: z
    .array(
      z.strictObject({
        id: objectIdSchema,
        quantity: z.coerce.number().int().min(1).max(50),
      }),
    )
    .min(1, "Cart is empty")
    .max(50),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

export const verifyPaymentSchema = z.strictObject({
  orderId: objectIdSchema,
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

export const updateOrderStatusSchema = z.strictObject({
  status: z.enum(["preparing", "out of delivery", "cancelled"]),
  /** Only meaningful with status "preparing": the kitchen's own preparation estimate. */
  prepMinutes: z.coerce.number().int().min(1).max(120).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const orderStatusParamsSchema = z.strictObject({
  orderId: objectIdSchema,
  shopId: objectIdSchema,
});

export const deliveryOtpRequestSchema = z.strictObject({
  orderId: objectIdSchema,
  shopOrderId: objectIdSchema,
});

export const verifyDeliveryOtpSchema = deliveryOtpRequestSchema.extend({
  otp: z.string().regex(/^\d{4}$/, "OTP must be exactly 4 digits"),
});

export const orderListQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
});

export const updateLocationSchema = z.strictObject({
  lat: latitudeSchema,
  lon: longitudeSchema,
});
