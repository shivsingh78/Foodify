import { TileLayer } from 'react-leaflet'
import { getTileLayerProps } from '../utils/mapTiles'

/** Geoapify tile layer for every map. Renders nothing (a blank map) when the map key is not configured. */
export const MapTiles = () => {
  const props = getTileLayerProps()
  return props ? <TileLayer {...props} /> : null
}

/** Shown under a map when tiles are unavailable; address search keeps working. */
export const MapKeyNotice = () =>
  getTileLayerProps() ? null : (
    <p className="mt-1 text-xs text-muted" role="status">
      Map tiles are unavailable right now. You can still search for an address.
    </p>
  )
