import type { Request, Response } from "express";
import { currentUserId } from "../middlewares/auth.js";
import { validatedQuery } from "../middlewares/validate.js";
import { getOrchestrationMetrics } from "../services/orchestration/metrics.js";
import * as service from "../services/orchestration/orchestration.service.js";

export const list = async (req: Request, res: Response) => {
  res.status(200).json(await service.listIncidents(validatedQuery(req)));
};
export const metrics = async (_req: Request, res: Response) => {
  res.status(200).json(await getOrchestrationMetrics());
};
export const getOne = async (req: Request, res: Response) => {
  res.status(200).json(await service.getIncident(String(req.params.incidentId)));
};
export const resolve = async (req: Request, res: Response) => {
  res.status(200).json(await service.resolveIncident(currentUserId(req), String(req.params.incidentId), String(req.body.reason)));
};
export const retry = async (req: Request, res: Response) => {
  res.status(200).json(await service.retryIncident(currentUserId(req), String(req.params.incidentId)));
};
export const backlog = async (req: Request, res: Response) => {
  res.status(200).json(await service.listBacklog(validatedQuery(req)));
};
export const processBacklog = async (req: Request, res: Response) => {
  res.status(201).json(await service.processBacklogItem(currentUserId(req), String(req.body.orderId), String(req.body.shopOrderId)));
};
