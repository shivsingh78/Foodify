import type { Request, Response } from "express";
import { currentUserId } from "../middlewares/auth.js";
import { validatedQuery } from "../middlewares/validate.js";
import * as notificationService from "../services/notification.service.js";

export const list = async (req: Request, res: Response) => {
  const query = validatedQuery<{ page: number; limit: number; unreadOnly?: boolean }>(req);
  res.status(200).json(await notificationService.listNotifications(currentUserId(req), query));
};

export const markRead = async (req: Request, res: Response) => {
  res
    .status(200)
    .json(await notificationService.markNotificationRead(currentUserId(req), String(req.params.notificationId)));
};

export const markAllRead = async (req: Request, res: Response) => {
  res.status(200).json(await notificationService.markAllNotificationsRead(currentUserId(req)));
};
