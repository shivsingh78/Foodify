import type { Request, Response } from "express";
import { currentUserId } from "../middlewares/auth.js";
import { createOrUpdateShop, getMyShop, getShopsByCity } from "../services/shop.service.js";

export const createEditShop = async (req: Request, res: Response) => {
  const { shop, created } = await createOrUpdateShop(currentUserId(req), req.body, req.file?.path);
  res.status(created ? 201 : 200).json(shop);
};

export const getMyShopHandler = async (req: Request, res: Response) => {
  res.status(200).json(await getMyShop(currentUserId(req)));
};

export const getShopByCity = async (req: Request, res: Response) => {
  res.status(200).json(await getShopsByCity(String(req.params.city)));
};
