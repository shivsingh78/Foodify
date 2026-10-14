import { Types } from "mongoose";
import {
  buildPaginationMeta,
  type AddItemInput,
  type EditItemInput,
  type ItemSearchQuery,
} from "@foodify/validation";
import Item from "../models/item.model.js";
import Order from "../models/order.model.js";
import Rating from "../models/rating.model.js";
import Shop from "../models/shop.model.js";
import { AppError } from "../utils/AppError.js";
import { deleteFromCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js";
import { escapeRegex } from "../utils/crypto.js";
import { cityKey, invalidateCache, withCache } from "./cache.service.js";
import { cityRegex, getOwnerShopOrThrow, populateShop } from "./shop.service.js";

const CITY_ITEMS_TTL_SECONDS = 60;
const SHOP_MENU_TTL_SECONDS = 60;

const invalidateCatalogCache = async () => {
  await Promise.all([invalidateCache("items:"), invalidateCache("shops:"), invalidateCache("menu:")]);
};

export const addItem = async (ownerId: string, input: AddItemInput, imagePath?: string) => {
  if (!imagePath) throw AppError.badRequest("Item image is required");
  const shop = await getOwnerShopOrThrow(ownerId);
  const image = await uploadOnCloudinary(imagePath);

  const item = await Item.create({ ...input, image, shop: shop._id });
  shop.items.push(item._id);
  await shop.save();
  await invalidateCatalogCache();
  return populateShop(shop._id);
};

/** Loads an item and verifies that it belongs to the caller's shop. */
const getOwnedItemOrThrow = async (ownerId: string, itemId: string) => {
  const shop = await getOwnerShopOrThrow(ownerId);
  const item = await Item.findById(itemId);
  if (!item) throw AppError.notFound("Item not found");
  if (!item.shop || !item.shop.equals(shop._id)) {
    throw AppError.forbidden("You can only manage items from your own shop");
  }
  return { shop, item };
};

export const editItem = async (
  ownerId: string,
  itemId: string,
  input: EditItemInput,
  imagePath?: string,
) => {
  const { shop, item } = await getOwnedItemOrThrow(ownerId, itemId);
  const previousImage = item.image;
  const { isAvailable, ...fields } = input;

  Object.assign(item, fields);
  if (isAvailable !== undefined) item.isAvailable = isAvailable;
  if (imagePath) item.image = await uploadOnCloudinary(imagePath);
  await item.save();
  if (imagePath) void deleteFromCloudinary(previousImage);

  await invalidateCatalogCache();
  return populateShop(shop._id);
};

export const deleteItem = async (ownerId: string, itemId: string) => {
  const { shop, item } = await getOwnedItemOrThrow(ownerId, itemId);
  await Item.deleteOne({ _id: item._id });
  await Shop.updateOne({ _id: shop._id }, { $pull: { items: item._id } });
  void deleteFromCloudinary(item.image);
  await invalidateCatalogCache();
  return populateShop(shop._id);
};

export const getItemById = async (itemId: string) => {
  const item = await Item.findById(itemId);
  if (!item) throw AppError.notFound("Item not found");
  return item;
};

export const getItemsByCity = (city: string) =>
  withCache(`items:${cityKey(city)}`, CITY_ITEMS_TTL_SECONDS, async () => {
    const shopIds = await Shop.find({ city: cityRegex(city) }).distinct("_id");
    return JSON.parse(JSON.stringify(await Item.find({ shop: { $in: shopIds } }).lean()));
  });

export const getShopMenu = async (shopId: string) =>
  withCache(`menu:${shopId}`, SHOP_MENU_TTL_SECONDS, async () => {
    const shop = await Shop.findById(shopId).populate("items").lean();
    if (!shop) return null;
    return JSON.parse(JSON.stringify({ shop, items: shop.items }));
  }).then((menu) => {
    if (!menu) throw AppError.notFound("Shop not found");
    return menu;
  });

const SORTS = {
  relevance: { "rating.average": -1, "rating.count": -1, _id: -1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: 1 },
  rating: { "rating.average": -1, "rating.count": -1, _id: -1 },
  newest: { createdAt: -1, _id: -1 },
} as const;

export const searchItems = async (q: ItemSearchQuery) => {
  const shopFilter: Record<string, unknown> = { city: cityRegex(q.city) };
  if (q.shopId) shopFilter._id = new Types.ObjectId(q.shopId);
  const shopIds = await Shop.find(shopFilter).distinct("_id");

  const filter: Record<string, unknown> = { shop: { $in: shopIds } };
  if (q.query) {
    const pattern = { $regex: escapeRegex(q.query), $options: "i" };
    filter.$or = [{ name: pattern }, { category: pattern }];
  }
  if (q.category) filter.category = q.category;
  if (q.foodType) filter.foodType = q.foodType;
  if (q.available !== undefined) {
    // Documents created before the flag existed are treated as available.
    filter.isAvailable = q.available ? { $ne: false } : false;
  }
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    filter.price = {
      ...(q.minPrice !== undefined && { $gte: q.minPrice }),
      ...(q.maxPrice !== undefined && { $lte: q.maxPrice }),
    };
  }

  const [items, total] = await Promise.all([
    Item.find(filter)
      .sort(SORTS[q.sort])
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate("shop", "name image")
      .lean(),
    Item.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(q.page, q.limit, total) };
};

/**
 * One rating per customer per item, and only for items from a delivered order.
 * The aggregate on the item is updated atomically from the delta.
 */
export const rateItem = async (userId: string, itemId: string, value: number) => {
  const item = await Item.findById(itemId).select("_id");
  if (!item) throw AppError.notFound("Item not found");

  const purchased = await Order.exists({
    user: userId,
    shopOrders: { $elemMatch: { status: "delivered", "shopOrderItems.item": item._id } },
  });
  if (!purchased) throw AppError.forbidden("You can only rate items from a delivered order");

  const previous = await Rating.findOneAndUpdate(
    { user: userId, item: item._id },
    { value },
    { upsert: true, new: false },
  );

  if (previous) {
    await Item.updateOne({ _id: item._id }, [
      {
        $set: {
          "rating.average": {
            $cond: [
              { $gt: ["$rating.count", 0] },
              {
                $add: [
                  "$rating.average",
                  { $divide: [value - previous.value, "$rating.count"] },
                ],
              },
              value,
            ],
          },
        },
      },
    ]);
  } else {
    await Item.updateOne({ _id: item._id }, [
      {
        $set: {
          "rating.average": {
            $divide: [
              { $add: [{ $multiply: ["$rating.average", "$rating.count"] }, value] },
              { $add: ["$rating.count", 1] },
            ],
          },
          "rating.count": { $add: ["$rating.count", 1] },
        },
      },
    ]);
  }

  const updated = await Item.findById(item._id).select("rating").lean();
  await invalidateCatalogCache();
  return updated?.rating;
};
