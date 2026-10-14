import { Types } from "mongoose";
import Order from "../models/order.model.js";
import { round2 } from "./pricing.js";

type StatusCount = { status: string; count: number };

/**
 * Owner analytics. Everything is scoped to shop orders owned by `ownerId` and
 * excludes unpaid online orders (they are not real orders yet).
 * Revenue counts delivered shop orders only.
 */
export const getOwnerAnalytics = async (ownerId: string, days: number) => {
  const owner = new Types.ObjectId(ownerId);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [result] = await Order.aggregate<{
    summary: { total: number; delivered: number; cancelled: number; revenue: number }[];
    byStatus: StatusCount[];
    revenueByDay: { date: string; revenue: number; orders: number }[];
    topProducts: { itemId: Types.ObjectId; name: string; quantity: number; revenue: number }[];
  }>([
    {
      $match: {
        createdAt: { $gte: since },
        "shopOrders.owner": owner,
        $or: [{ paymentMethod: "cod" }, { payment: true }],
      },
    },
    { $unwind: "$shopOrders" },
    { $match: { "shopOrders.owner": owner } },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              delivered: { $sum: { $cond: [{ $eq: ["$shopOrders.status", "delivered"] }, 1, 0] } },
              cancelled: { $sum: { $cond: [{ $eq: ["$shopOrders.status", "cancelled"] }, 1, 0] } },
              revenue: {
                $sum: { $cond: [{ $eq: ["$shopOrders.status", "delivered"] }, "$shopOrders.subtotal", 0] },
              },
            },
          },
        ],
        byStatus: [
          { $group: { _id: "$shopOrders.status", count: { $sum: 1 } } },
          { $project: { _id: 0, status: "$_id", count: 1 } },
          { $sort: { status: 1 } },
        ],
        revenueByDay: [
          { $match: { "shopOrders.status": "delivered", "shopOrders.deliveredAt": { $ne: null } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$shopOrders.deliveredAt" } },
              revenue: { $sum: "$shopOrders.subtotal" },
              orders: { $sum: 1 },
            },
          },
          { $project: { _id: 0, date: "$_id", revenue: 1, orders: 1 } },
          { $sort: { date: 1 } },
        ],
        topProducts: [
          { $match: { "shopOrders.status": { $ne: "cancelled" } } },
          { $unwind: "$shopOrders.shopOrderItems" },
          {
            $group: {
              _id: "$shopOrders.shopOrderItems.item",
              name: { $first: "$shopOrders.shopOrderItems.name" },
              quantity: { $sum: "$shopOrders.shopOrderItems.quantity" },
              revenue: {
                $sum: {
                  $multiply: ["$shopOrders.shopOrderItems.price", "$shopOrders.shopOrderItems.quantity"],
                },
              },
            },
          },
          { $sort: { quantity: -1, revenue: -1 } },
          { $limit: 5 },
          { $project: { _id: 0, itemId: "$_id", name: 1, quantity: 1, revenue: 1 } },
        ],
      },
    },
  ]);

  const summary = result?.summary[0] ?? { total: 0, delivered: 0, cancelled: 0, revenue: 0 };
  return {
    rangeDays: days,
    totalOrders: summary.total,
    completedOrders: summary.delivered,
    cancelledOrders: summary.cancelled,
    cancellationRate: summary.total ? round2((summary.cancelled / summary.total) * 100) : 0,
    totalRevenue: round2(summary.revenue),
    averageOrderValue: summary.delivered ? round2(summary.revenue / summary.delivered) : 0,
    ordersByStatus: result?.byStatus ?? [],
    revenueByDay: result?.revenueByDay ?? [],
    topProducts: result?.topProducts ?? [],
  };
};
