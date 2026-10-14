import type { GeoPlace } from "@foodify/validation";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { withCache } from "./cache.service.js";

// Fixed upstream; nothing from the request is ever used to choose the host or path.
const GEOAPIFY_BASE = "https://api.geoapify.com/v1/geocode";
const TIMEOUT_MS = 5000;
const AUTOCOMPLETE_TTL_SECONDS = 10 * 60;
const REVERSE_TTL_SECONDS = 60 * 60;

type GeoapifyResult = {
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
  lat?: number;
  lon?: number;
};

const callGeoapify = async (endpoint: "autocomplete" | "reverse", params: Record<string, string>): Promise<GeoapifyResult[]> => {
  const apiKey = env.GEOAPIFY_API_KEY;
  if (!apiKey) throw new AppError(503, "Address search is not configured on the server", "GEOAPIFY_NOT_CONFIGURED");

  const url = new URL(`${GEOAPIFY_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", apiKey);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new AppError(504, "Address search timed out. Please try again.", "GEOCODER_TIMEOUT");
    }
    throw new AppError(502, "Address search is unavailable right now", "GEOCODER_UNAVAILABLE");
  }
  if (!response.ok) {
    // Never forward upstream bodies: they can echo the request URL including the key.
    console.error(`Geoapify ${endpoint} failed with status ${response.status}`);
    throw new AppError(502, "Address search is unavailable right now", "GEOCODER_ERROR");
  }

  const body = (await response.json().catch(() => null)) as { results?: GeoapifyResult[] } | null;
  return Array.isArray(body?.results) ? body.results : [];
};

const normalise = (r: GeoapifyResult): GeoPlace | null => {
  if (typeof r.lat !== "number" || typeof r.lon !== "number") return null;
  return {
    formatted: r.formatted ?? r.address_line2 ?? r.address_line1 ?? "",
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    state: r.state,
    country: r.country,
    latitude: r.lat,
    longitude: r.lon,
  };
};

const toPlaces = (results: GeoapifyResult[]): GeoPlace[] =>
  results.map(normalise).filter((p): p is GeoPlace => p !== null);

export const autocompleteAddress = (text: string, limit: number) =>
  withCache(`geo:ac:${limit}:${text.toLowerCase()}`, AUTOCOMPLETE_TTL_SECONDS, async () =>
    toPlaces(await callGeoapify("autocomplete", { text, limit: String(limit) })),
  );

export const reverseGeocode = (lat: number, lon: number) =>
  withCache(`geo:rev:${lat.toFixed(5)}:${lon.toFixed(5)}`, REVERSE_TTL_SECONDS, async () =>
    toPlaces(await callGeoapify("reverse", { lat: String(lat), lon: String(lon) })).slice(0, 1),
  );
