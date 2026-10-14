import type { Request, Response } from "express";
import { currentUserId } from "../middlewares/auth.js";
import { getUserById, updateUserLocation } from "../services/user.service.js";

export const getCurrentUser = async (req: Request, res: Response) => {
  res.status(200).json(await getUserById(currentUserId(req)));
};

export const updateLocation = async (req: Request, res: Response) => {
  await updateUserLocation(currentUserId(req), req.body.lat, req.body.lon);
  res.status(200).json({ message: "Location updated successfully." });
};
