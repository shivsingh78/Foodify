import { z } from "zod";
import { latitudeSchema, longitudeSchema } from "./common.schema.js";

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max);

/** Multipart form fields; the image file is handled by the upload middleware. */
export const createEditShopSchema = z
  .strictObject({
    name: text("Shop name", 80),
    city: text("City", 60),
    state: text("State", 60),
    address: text("Address", 200),
    // Pickup point used by delivery dispatch. Optional: omitting both keeps the stored location.
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
  })
  .refine((s) => (s.latitude === undefined) === (s.longitude === undefined), {
    message: "Send both latitude and longitude for the shop location",
    path: ["latitude"],
  })
  .refine((s) => !(s.latitude === 0 && s.longitude === 0), { message: "Select the shop location on the map", path: ["latitude"] });
export type CreateEditShopInput = z.infer<typeof createEditShopSchema>;

export const cityParamSchema = z.strictObject({ city: text("City", 60) });
