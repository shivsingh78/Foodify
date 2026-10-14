import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Leaflet needs a browser; only the key/URL logic and the notice are under test here.
vi.mock('react-leaflet', () => ({ TileLayer: () => null }))

import { MAP_ATTRIBUTION, getTileLayerProps } from '../src/utils/mapTiles.js'
import { readPublicConfig } from '../src/runtimeConfig.js'
import { MapKeyNotice } from '../src/components/MapTiles.jsx'

describe('map tile configuration', () => {
  it('builds the Geoapify osm-carto URL from the public runtime key, with attribution', () => {
    const props = getTileLayerProps(readPublicConfig({}, { VITE_GEOAPIFY_MAPS_API_KEY: 'abc 123' }))
    expect(props.url).toBe('https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}.png?apiKey=abc%20123')
    expect(props.attribution).toBe(MAP_ATTRIBUTION)
    expect(props.attribution).toMatch(/Geoapify/)
    expect(props.attribution).toMatch(/OpenStreetMap<\/a> contributors/)
  })

  it('returns null, never a malformed URL or the OSM server, when the key is missing', () => {
    expect(getTileLayerProps(readPublicConfig({}, {}))).toBeNull()
    expect(getTileLayerProps(readPublicConfig({ VITE_GEOAPIFY_MAPS_API_KEY: '' }, {}))).toBeNull()
  })

  it('does not pick up the server-side key name', () => {
    expect(readPublicConfig({}, { GEOAPIFY_API_KEY: 'server-secret' })).toEqual({})
  })

  it('shows a non-sensitive notice instead of crashing when the key is missing', () => {
    vi.stubEnv('VITE_GEOAPIFY_MAPS_API_KEY', '') // independent of a developer's local frontend/.env
    const html = renderToStaticMarkup(createElement(MapKeyNotice))
    vi.unstubAllEnvs()
    expect(html).toContain('Map tiles are unavailable')
    expect(html).not.toMatch(/apiKey|key=/i)
  })
})

describe('all maps share the Geoapify tile layer', () => {
  const files = ['src/components/LocationPicker.jsx', 'src/pages/CheckOut.jsx', 'src/components/DeliveryBoyTracking.jsx']
  for (const file of files) {
    it(`${file} uses <MapTiles /> and no hard-coded tile server`, () => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      expect(source).toContain('<MapTiles />')
      expect(source).toContain('<MapKeyNotice />')
      expect(source).not.toMatch(/tile\.openstreetmap\.org|<TileLayer/)
      expect(source).toMatch(/<MapContainer/) // the existing Leaflet map is kept
    })
  }
})
