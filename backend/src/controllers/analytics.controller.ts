import type { Request, Response } from "express";
import type { AnalyticsQuery } from "@foodify/validation";
import { currentUserId } from "../middlewares/auth.js";
import { validatedQuery } from "../middlewares/validate.js";
import { getDispatchMetrics } from "../services/dispatch/metrics.service.js";
import { getOwnerAnalytics } from "../services/analytics.service.js";

export const ownerAnalytics = async (req: Request, res: Response) => {
  const { days } = validatedQuery<AnalyticsQuery>(req);
  res.status(200).json(await getOwnerAnalytics(currentUserId(req), days));
};

export const dispatchMetrics = async (req: Request, res: Response) => {
  const { days } = validatedQuery<AnalyticsQuery>(req);
  res.status(200).json(await getDispatchMetrics(days));
};
