import express from "express";
import { z } from "zod";
import {
  deliveryOtpRequestSchema,
  idParamSchema,
  objectIdSchema,
  orderStatusParamsSchema,
  placeOrderSchema,
  updateOrderStatusSchema,
  verifyDeliveryOtpSchema,
  verifyPaymentSchema,
} from "@foodify/validation";
import {
  acceptOrder,
  declineOffer,
  dispatchStatus,
  getCurrentOrder,
  getDeliveryBoyAssignment,
  getMyOrders,
  getOrderById,
  getTodayDeliveries,
  placeOrder,
  sendDeliveryOtp,
  updateOrderStatus,
  verifyDeliveryOtp,
  verifyPayment,
} from "../controllers/order.controller.js";
import { isAuth, requireRole } from "../middlewares/auth.js";
import { limits } from "../middlewares/rateLimit.js";
import { validate } from "../middlewares/validate.js";

const orderRouter = express.Router();
orderRouter.use(isAuth);

// Customer
orderRouter.post("/place-order", requireRole("user"), limits.orderWrite, validate(placeOrderSchema), placeOrder);
orderRouter.post("/verify-payment", requireRole("user"), limits.payment, validate(verifyPaymentSchema), verifyPayment);
orderRouter.get("/my-orders", getMyOrders);
orderRouter.get("/get-order-by-id/:orderId", validate({ params: idParamSchema("orderId") }), getOrderById);

// Shop owner
orderRouter.post(
  "/update-status/:orderId/:shopId",
  requireRole("owner"),
  limits.orderWrite,
  validate({ params: orderStatusParamsSchema, body: updateOrderStatusSchema }),
  updateOrderStatus,
);

// Delivery partner
orderRouter.get("/get-assignments", requireRole("deliveryBoy"), getDeliveryBoyAssignment);
// State-changing, so POST rather than GET (CSRF-safe).
orderRouter.post(
  "/accept-order/:assignmentId",
  requireRole("deliveryBoy"),
  validate({ params: idParamSchema("assignmentId") }),
  acceptOrder,
);
orderRouter.post(
  "/decline-offer/:offerId",
  requireRole("deliveryBoy"),
  validate({ params: idParamSchema("offerId") }),
  declineOffer,
);
// Customer, owner of that shop order, or admin.
orderRouter.get(
  "/dispatch-status/:orderId/:shopOrderId",
  validate({ params: z.strictObject({ orderId: objectIdSchema, shopOrderId: objectIdSchema }) }),
  dispatchStatus,
);
orderRouter.get("/get-current-order", requireRole("deliveryBoy"), getCurrentOrder);
orderRouter.post(
  "/send-delivery-otp",
  requireRole("deliveryBoy"),
  limits.deliveryOtp,
  validate(deliveryOtpRequestSchema),
  sendDeliveryOtp,
);
orderRouter.post(
  "/verify-delivery-otp",
  requireRole("deliveryBoy"),
  limits.deliveryOtp,
  validate(verifyDeliveryOtpSchema),
  verifyDeliveryOtp,
);
orderRouter.get("/get-today-deliveries", requireRole("deliveryBoy"), getTodayDeliveries);

export default orderRouter;
