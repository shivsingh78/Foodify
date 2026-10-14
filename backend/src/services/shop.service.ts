import { toGeoJsonPoint, type CreateEditShopInput } from "@foodify/validation";
import Shop from "../models/shop.model.js";
import { AppError } from "../utils/AppError.js";
import { deleteFromCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js";
import { escapeRegex } from "../utils/crypto.js";
import { cityKey, invalidateCache, withCache } from "./cache.service.js";

const CITY_CACHE_TTL_SECONDS = 60;

export const populateShop = (shopId: unknown) =>
  Shop.findById(shopId)
    .populate("owner", "fullName email mobile")
    .populate({ path: "items", options: { sort: { updatedAt: -1 } } });

export const cityRegex = (city: string) => new RegExp(`^${escapeRegex(city.trim())}$`, "i");

export const getOwnerShopOrThrow = async (ownerId: string) => {
  const shop = await Shop.findOne({ owner: ownerId });
  if (!shop) throw AppError.badRequest("Create your shop first", "SHOP_NOT_FOUND");
  return shop;
};

export const createOrUpdateShop = async (
  ownerId: string,
  input: CreateEditShopInput,
  imagePath?: string,
) => {
  const { latitude, longitude, ...fields } = input;
  // Only replaced when the owner picked a point; dispatch measures partner distance from it.
  const location = latitude !== undefined && longitude !== undefined ? toGeoJsonPoint(latitude, longitude) : undefined;
  const existing = await Shop.findOne({ owner: ownerId });
  if (!existing && !imagePath) throw AppError.badRequest("Shop image is required");

  const image = imagePath ? await uploadOnCloudinary(imagePath) : undefined;

  let shopId;
  let created = false;
  if (!existing) {
    const shop = await Shop.create({ ...fields, ...(location && { location }), image, owner: ownerId });
    shopId = shop._id;
    created = true;
  } else {
    const previousImage = existing.image;
    Object.assign(existing, fields);
    if (location) existing.location = location;
    if (image) existing.image = image;
    await existing.save();
    if (image) void deleteFromCloudinary(previousImage);
    shopId = existing._id;
  }

  await invalidateCache("shops:");
  await invalidateCache("items:");
  return { shop: await populateShop(shopId), created };
};

export const getMyShop = (ownerId: string) =>
  Shop.findOne({ owner: ownerId })
    .populate("owner", "fullName email mobile")
    .populate({ path: "items", options: { sort: { updatedAt: -1 } } });

export const getShopsByCity = (city: string) =>
  withCache(`shops:${cityKey(city)}`, CITY_CACHE_TTL_SECONDS, async () =>
    JSON.parse(
      JSON.stringify(await Shop.find({ city: cityRegex(city) }).populate("items").lean()),
    ),
  );
