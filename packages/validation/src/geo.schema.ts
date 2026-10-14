import { z } from "zod";
import { latitudeSchema, longitudeSchema } from "./common.schema.js";

export const geoAutocompleteQuerySchema = z.strictObject({
  text: z.string().trim().min(3, "Type at least 3 characters").max(200),
  limit: z.coerce.number().int().min(1).max(8).default(5),
});
export type GeoAutocompleteQuery = z.infer<typeof geoAutocompleteQuerySchema>;

export const geoReverseQuerySchema = z.strictObject({
  lat: latitudeSchema,
  lon: longitudeSchema,
});
export type GeoReverseQuery = z.infer<typeof geoReverseQuerySchema>;

/** Normalised address returned by the geocoding endpoints. */
export type GeoPlace = {
  formatted: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude: number;
  longitude: number;
};

export type GeoJsonPoint = { type: "Point"; coordinates: [number, number] };

/** GeoJSON is [longitude, latitude] — the reverse of how people usually say it. */
export const toGeoJsonPoint = (latitude: number, longitude: number): GeoJsonPoint => ({
  type: "Point",
  coordinates: [longitude, latitude],
});
