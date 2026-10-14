import { readPublicConfig } from '../runtimeConfig'

const TILE_URL = 'https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}.png'

export const MAP_ATTRIBUTION =
  'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> | &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'

/**
 * Leaflet TileLayer props for the Geoapify raster tiles, or null when no map key is configured.
 * The key is a browser-facing, domain-restricted key (VITE_GEOAPIFY_MAPS_API_KEY), distinct from the
 * server-side GEOAPIFY_API_KEY. There is deliberately no fallback to the public OpenStreetMap tile server.
 */
export const getTileLayerProps = (config = readPublicConfig()) => {
  const key = config.VITE_GEOAPIFY_MAPS_API_KEY
  if (!key) return null
  return { url: `${TILE_URL}?apiKey=${encodeURIComponent(key)}`, attribution: MAP_ATTRIBUTION }
}
