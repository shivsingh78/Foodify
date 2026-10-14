import type { Request, Response } from "express";
import type { ApplicationListQuery, ApplicationRole } from "@foodify/validation";
import { currentUserId } from "../middlewares/auth.js";
import { validatedQuery } from "../middlewares/validate.js";
import * as service from "../services/application.service.js";
import { AppError } from "../utils/AppError.js";

const submit = (role: ApplicationRole) => async (req: Request, res: Response) => {
  const application = await service.submitApplication(currentUserId(req), role, req.body, req.file?.path);
  res.status(201).json(application);
};
export const submitOwner = submit("owner");
export const submitDelivery = submit("deliveryBoy");

export const resubmit = async (req: Request, res: Response) => {
  res.status(200).json(await service.resubmitApplication(currentUserId(req), String(req.params.applicationId), req.body, req.file?.path));
};

export const mine = async (req: Request, res: Response) => {
  res.status(200).json(await service.listMyApplications(currentUserId(req)));
};

export const getOne = async (req: Request, res: Response) => {
  if (!req.userRole) throw AppError.unauthorized();
  res.status(200).json(await service.getApplication(currentUserId(req), req.userRole, String(req.params.applicationId)));
};

export const adminList = async (req: Request, res: Response) => {
  res.status(200).json(await service.listApplications(validatedQuery<ApplicationListQuery>(req)));
};

export const approve = async (req: Request, res: Response) => {
  const { application, alreadyApproved } = await service.approveApplication(currentUserId(req), String(req.params.applicationId));
  res.status(200).json({ application, alreadyApproved });
};

export const reject = async (req: Request, res: Response) => {
  res.status(200).json({ application: await service.rejectApplication(currentUserId(req), String(req.params.applicationId), req.body.reason) });
};

export const requestInfo = async (req: Request, res: Response) => {
  res.status(200).json({ application: await service.requestMoreInfo(currentUserId(req), String(req.params.applicationId), req.body.reason) });
};
