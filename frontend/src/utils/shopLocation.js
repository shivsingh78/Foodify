/**
 * Converts a stored GeoJSON Point ([longitude, latitude]) into the { latitude, longitude } the map picker uses.
 * Returns null when there is no usable location (missing, malformed, or the [0, 0] "never set" default).
 */
export const shopPointFromLocation = (location) => {
  const c = location?.coordinates
  if (!Array.isArray(c) || c.length !== 2) return null
  const [longitude, latitude] = c.map(Number)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude === 0 && longitude === 0) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}
