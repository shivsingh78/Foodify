import { z } from "zod";

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max);

/** Multipart form fields; the image file is handled by the upload middleware. */
export const createEditShopSchema = z.strictObject({
  name: text("Shop name", 80),
  city: text("City", 60),
  state: text("State", 60),
  address: text("Address", 200),
});
export type CreateEditShopInput = z.infer<typeof createEditShopSchema>;

export const cityParamSchema = z.strictObject({ city: text("City", 60) });
