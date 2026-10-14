export type LonLat = readonly [longitude: number, latitude: number];

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

export const isValidLonLat = (p: unknown): p is LonLat =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every((n) => typeof n === "number" && Number.isFinite(n)) &&
  Math.abs(p[0] as number) <= 180 &&
  Math.abs(p[1] as number) <= 90 &&
  // [0, 0] is the schema default for "never reported a location", not a real position.
  !(p[0] === 0 && p[1] === 0);

/** Great-circle distance in kilometres. */
export const haversineKm = (a: LonLat, b: LonLat): number => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};
