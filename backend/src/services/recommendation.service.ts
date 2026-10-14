import { Types } from "mongoose";
import Item from "../models/item.model.js";
import Order from "../models/order.model.js";
import Shop from "../models/shop.model.js";
import { cityKey, withCache } from "./cache.service.js";
import { cityRegex } from "./shop.service.js";

const POPULARITY_WINDOW_DAYS = 30;
const POPULARITY_TTL_SECONDS = 300;

/** Units sold per item in a city over the last 30 days (cancelled orders excluded). Shared by all users, so cacheable. */
const getCityPopularity = (city: string) =>
  withCache(`reco:popularity:${cityKey(city)}`, POPULARITY_TTL_SECONDS, async () => {
    const shopIds = await Shop.find({ city: cityRegex(city) }).distinct("_id");
    const since = new Date(Date.now() - POPULARITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await Order.aggregate<{ _id: unknown; sold: number }>([
      { $match: { createdAt: { $gte: since }, $or: [{ paymentMethod: "cod" }, { payment: true }] } },
      { $unwind: "$shopOrders" },
      { $match: { "shopOrders.shop": { $in: shopIds }, "shopOrders.status": { $ne: "cancelled" } } },
      { $unwind: "$shopOrders.shopOrderItems" },
      { $group: { _id: "$shopOrders.shopOrderItems.item", sold: { $sum: "$shopOrders.shopOrderItems.quantity" } } },
    ]);
    return rows.map((r) => ({ itemId: String(r._id), sold: r.sold }));
  });

/** How much of the user's own past ordering falls into each category (0..1). */
const getCategoryAffinity = async (userId: string): Promise<Map<string, number>> => {
  const rows = await Order.aggregate<{ _id: string; units: number }>([
    { $match: { user: new Types.ObjectId(userId) } },
    { $unwind: "$shopOrders" },
    { $match: { "shopOrders.status": { $ne: "cancelled" } } },
    { $unwind: "$shopOrders.shopOrderItems" },
    { $lookup: { from: "items", localField: "shopOrders.shopOrderItems.item", foreignField: "_id", as: "it" } },
    { $unwind: "$it" },
    { $group: { _id: "$it.category", units: { $sum: "$shopOrders.shopOrderItems.quantity" } } },
  ]);
  const total = rows.reduce((s, r) => s + r.units, 0);
  return new Map(rows.map((r) => [r._id, total ? r.units / total : 0]));
};

/**
 * Explainable ranking, not a trained model:
 *   score = 0.6 * popularity + 0.3 * category affinity + 0.1 * rating
 * New users (no order history) get popularity + rating only.
 */
export const recommendItems = async (userId: string, city: string, limit: number) => {
  const [popularity, affinity] = await Promise.all([getCityPopularity(city), getCategoryAffinity(userId)]);
  const soldById = new Map(popularity.map((p) => [p.itemId, p.sold]));
  const maxSold = Math.max(1, ...popularity.map((p) => p.sold));
  const personalised = affinity.size > 0;

  const shopIds = await Shop.find({ city: cityRegex(city) }).distinct("_id");
  const items = await Item.find({ shop: { $in: shopIds }, isAvailable: { $ne: false } })
    .populate("shop", "name image")
    .lean();

  const ranked = items
    .map((item) => {
      const sold = soldById.get(String(item._id)) ?? 0;
      const pop = sold / maxSold;
      const aff = affinity.get(item.category) ?? 0;
      const rate = (item.rating?.average ?? 0) / 5;
      const score = personalised ? 0.6 * pop + 0.3 * aff + 0.1 * rate : 0.8 * pop + 0.2 * rate;
      const reason =
        personalised && aff > 0.25
          ? `Because you often order ${item.category}`
          : sold > 0
            ? "Popular in your city"
            : "Highly rated";
      return { item, score, reason };
    })
    .sort((a, b) => b.score - a.score || String(b.item._id).localeCompare(String(a.item._id)))
    .slice(0, limit);

  return ranked.map(({ item, reason, score }) => ({ ...item, reason, score: Math.round(score * 1000) / 1000 }));
};
