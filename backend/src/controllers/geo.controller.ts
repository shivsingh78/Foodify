import type { Request, Response } from "express";
import type { GeoAutocompleteQuery, GeoReverseQuery } from "@foodify/validation";
import { validatedQuery } from "../middlewares/validate.js";
import { autocompleteAddress, reverseGeocode } from "../services/geo.service.js";

export const autocomplete = async (req: Request, res: Response) => {
  const { text, limit } = validatedQuery<GeoAutocompleteQuery>(req);
  res.status(200).json({ results: await autocompleteAddress(text, limit) });
};

export const reverse = async (req: Request, res: Response) => {
  const { lat, lon } = validatedQuery<GeoReverseQuery>(req);
  res.status(200).json({ results: await reverseGeocode(lat, lon) });
};
