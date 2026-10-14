import express from "express";
import {
  addItemSchema,
  cityParamSchema,
  editItemSchema,
  idParamSchema,
  itemSearchQuerySchema,
  ratingSchema,
  recommendationQuerySchema,
} from "@foodify/validation";
import {
  addItem,
  deleteItem,
  editItem,
  getItemByCity,
  getItemById,
  getItemsByShop,
  rating,
  recommendations,
  searchItems,
} from "../controllers/item.controller.js";
import { isAuth, requireRole } from "../middlewares/auth.js";
import { upload } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";

const itemRouter = express.Router();
const itemIdParam = validate({ params: idParamSchema("itemId") });

itemRouter.post("/add-item", isAuth, requireRole("owner"), upload.single("image"), validate(addItemSchema), addItem);
itemRouter.post(
  "/edit-item/:itemId",
  isAuth,
  requireRole("owner"),
  upload.single("image"),
  itemIdParam,
  validate(editItemSchema),
  editItem,
);
itemRouter.get("/get-by-id/:itemId", isAuth, itemIdParam, getItemById);
// State-changing operations are never exposed as GET (CSRF); the old GET route is replaced.
itemRouter.delete("/delete/:itemId", isAuth, requireRole("owner"), itemIdParam, deleteItem);
itemRouter.get("/get-by-city/:city", isAuth, validate({ params: cityParamSchema }), getItemByCity);
itemRouter.get("/get-by-shop/:shopId", isAuth, validate({ params: idParamSchema("shopId") }), getItemsByShop);
itemRouter.get("/search-item", isAuth, validate({ query: itemSearchQuerySchema }), searchItems);
itemRouter.get("/recommendations", isAuth, validate({ query: recommendationQuerySchema }), recommendations);
itemRouter.post("/rating", isAuth, requireRole("user"), validate(ratingSchema), rating);

export default itemRouter;
