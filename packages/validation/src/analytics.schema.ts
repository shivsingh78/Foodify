import { z } from "zod";

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
