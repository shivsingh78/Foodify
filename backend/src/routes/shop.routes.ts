import express from "express";
import { cityParamSchema, createEditShopSchema } from "@foodify/validation";
import { createEditShop, getMyShopHandler, getShopByCity } from "../controllers/shop.controller.js";
import { isAuth, requireRole } from "../middlewares/auth.js";
import { upload } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";

const shopRouter = express.Router();

shopRouter.post(
  "/create-edit",
  isAuth,
  requireRole("owner"),
  upload.single("image"),
  validate(createEditShopSchema),
  createEditShop,
);
shopRouter.get("/get-my", isAuth, requireRole("owner"), getMyShopHandler);
shopRouter.get("/get-by-city/:city", isAuth, validate({ params: cityParamSchema }), getShopByCity);

export default shopRouter;
