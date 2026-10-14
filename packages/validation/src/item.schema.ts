import { z } from "zod";
import { objectIdSchema } from "./common.schema.js";
import { paginationSchema } from "./pagination.schema.js";

export const ITEM_CATEGORIES = [
  "Snacks",
  "Main Course",
  "Desserts",
  "Pizza",
  "Burgers",
  "Sandwiches",
  "South Indian",
  "North Indian",
  "Chinese",
  "Fast Food",
  "Others",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const FOOD_TYPES = ["veg", "non veg"] as const;

const booleanString = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true");

const itemFields = {
  name: z.string().trim().min(1, "Name is required").max(100),
  category: z.enum(ITEM_CATEGORIES),
  foodType: z.enum(FOOD_TYPES),
  price: z.coerce.number().min(0, "Price cannot be negative").max(100000),
  isAvailable: booleanString.optional(),
};

export const addItemSchema = z.strictObject(itemFields);
export type AddItemInput = z.infer<typeof addItemSchema>;

export const editItemSchema = z.strictObject(itemFields);
export type EditItemInput = z.infer<typeof editItemSchema>;

export const ratingSchema = z.strictObject({
  itemId: objectIdSchema,
  rating: z.coerce.number().int().min(1).max(5),
});
export type RatingInput = z.infer<typeof ratingSchema>;

export const ITEM_SORTS = [
  "relevance",
  "price_asc",
  "price_desc",
  "rating",
  "newest",
] as const;

/** `query` keeps the parameter name already used by the frontend. */
export const itemSearchQuerySchema = paginationSchema.extend({
  query: z.string().trim().max(100).optional(),
  city: z.string().trim().min(1, "City is required").max(60),
  category: z.enum(ITEM_CATEGORIES).optional(),
  foodType: z.enum(FOOD_TYPES).optional(),
  shopId: objectIdSchema.optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  available: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  sort: z.enum(ITEM_SORTS).default("relevance"),
});
export type ItemSearchQuery = z.infer<typeof itemSearchQuerySchema>;

export const recommendationQuerySchema = z.object({
  city: z.string().trim().min(1, "City is required").max(60),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});
export type RecommendationQuery = z.infer<typeof recommendationQuerySchema>;
