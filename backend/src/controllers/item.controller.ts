import type { Request, Response } from "express";
import type { ItemSearchQuery, RecommendationQuery } from "@foodify/validation";
import { currentUserId } from "../middlewares/auth.js";
import { validatedQuery } from "../middlewares/validate.js";
import { recommendItems } from "../services/recommendation.service.js";
import * as itemService from "../services/item.service.js";

export const addItem = async (req: Request, res: Response) => {
  res.status(201).json(await itemService.addItem(currentUserId(req), req.body, req.file?.path));
};

export const editItem = async (req: Request, res: Response) => {
  res
    .status(200)
    .json(await itemService.editItem(currentUserId(req), String(req.params.itemId), req.body, req.file?.path));
};

export const deleteItem = async (req: Request, res: Response) => {
  res.status(200).json(await itemService.deleteItem(currentUserId(req), String(req.params.itemId)));
};

export const getItemById = async (req: Request, res: Response) => {
  res.status(200).json(await itemService.getItemById(String(req.params.itemId)));
};

export const getItemByCity = async (req: Request, res: Response) => {
  res.status(200).json(await itemService.getItemsByCity(String(req.params.city)));
};

export const getItemsByShop = async (req: Request, res: Response) => {
  res.status(200).json(await itemService.getShopMenu(String(req.params.shopId)));
};

export const searchItems = async (req: Request, res: Response) => {
  res.status(200).json(await itemService.searchItems(validatedQuery<ItemSearchQuery>(req)));
};

export const rating = async (req: Request, res: Response) => {
  const result = await itemService.rateItem(currentUserId(req), req.body.itemId, req.body.rating);
  res.status(200).json({ rating: result });
};

export const recommendations = async (req: Request, res: Response) => {
  const { city, limit } = validatedQuery<RecommendationQuery>(req);
  res.status(200).json(await recommendItems(currentUserId(req), city, limit));
};
