import { diagnoseDispatch, myDispatchEligibility } from "../services/dispatch/diagnosis.service.js";
import type { Request, Response } from "express";
import { currentUserId } from "../middlewares/auth.js";
import { declineOffer as declineOfferService, getDispatchStatus } from "../services/dispatch/dispatch.service.js";
import * as orderService from "../services/order.service.js";
import { AppError } from "../utils/AppError.js";

const role = (req: Request) => {
  if (!req.userRole) throw AppError.unauthorized();
  return req.userRole;
};

export const placeOrder = async (req: Request, res: Response) => {
  const result = await orderService.placeOrder(currentUserId(req), req.body);
  if (result.kind === "cod") {
    res.status(201).json(result.order);
    return;
  }
  res.status(200).json({ razorOrder: result.razorOrder, orderId: result.orderId });
};

export const verifyPayment = async (req: Request, res: Response) => {
  res.status(200).json(await orderService.verifyPayment(currentUserId(req), req.body));
};

export const getMyOrders = async (req: Request, res: Response) => {
  res.status(200).json(await orderService.getMyOrders(currentUserId(req), role(req)));
};

export const getOrderById = async (req: Request, res: Response) => {
  res
    .status(200)
    .json(await orderService.getOrderById(currentUserId(req), role(req), String(req.params.orderId)));
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  res
    .status(200)
    .json(
      await orderService.updateOrderStatus(
        currentUserId(req),
        String(req.params.orderId),
        String(req.params.shopId),
        req.body,
      ),
    );
};

export const getDeliveryBoyAssignment = async (req: Request, res: Response) => {
  res.status(200).json(await orderService.getDeliveryAssignments(currentUserId(req)));
};

export const acceptOrder = async (req: Request, res: Response) => {
  const result = await orderService.acceptAssignment(currentUserId(req), String(req.params.assignmentId));
  res.status(200).json({ success: true, message: "Order accepted successfully", ...result });
};

export const getCurrentOrder = async (req: Request, res: Response) => {
  res.status(200).json(await orderService.getCurrentDelivery(currentUserId(req)));
};

export const sendDeliveryOtp = async (req: Request, res: Response) => {
  res
    .status(200)
    .json(await orderService.sendDeliveryOtp(currentUserId(req), req.body.orderId, req.body.shopOrderId));
};

export const verifyDeliveryOtp = async (req: Request, res: Response) => {
  await orderService.verifyDeliveryOtp(currentUserId(req), req.body.orderId, req.body.shopOrderId, req.body.otp);
  res.status(200).json({ message: "Order delivered successfully" });
};

export const getTodayDeliveries = async (req: Request, res: Response) => {
  res.status(200).json(await orderService.getTodayDeliveries(currentUserId(req)));
};

export const declineOffer = async (req: Request, res: Response) => {
  res.status(200).json(await declineOfferService(currentUserId(req), String(req.params.offerId)));
};

export const dispatchStatus = async (req: Request, res: Response) => {
  res
    .status(200)
    .json(await getDispatchStatus(currentUserId(req), role(req), String(req.params.orderId), String(req.params.shopOrderId)));
};

export const dispatchDiagnosis = async (req: Request, res: Response) => {
  res.status(200).json(await diagnoseDispatch(currentUserId(req), role(req) === "admin" ? "admin" : "owner"));
};

export const myEligibility = async (req: Request, res: Response) => {
  res.status(200).json(await myDispatchEligibility(currentUserId(req)));
};
