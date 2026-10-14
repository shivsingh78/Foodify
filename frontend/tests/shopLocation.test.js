import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createEditShopSchema } from '@foodify/validation'
import { shopPointFromLocation } from '../src/utils/shopLocation.js'

describe('shop pickup location', () => {
  it('reads the stored GeoJSON point in [longitude, latitude] order', () => {
    expect(shopPointFromLocation({ type: 'Point', coordinates: [77.472351, 23.256924] })).toEqual({ latitude: 23.256924, longitude: 77.472351 })
  })

  it('treats missing, malformed and [0, 0] locations as unset', () => {
    for (const bad of [undefined, null, {}, { coordinates: [] }, { coordinates: [0, 0] }, { coordinates: ['x', 1] }, { coordinates: [200, 10] }]) {
      expect(shopPointFromLocation(bad)).toBeNull()
    }
  })

  it('the form payload (multipart strings) passes the shared schema', () => {
    const base = { name: 'Shop', city: 'Bhopal', state: 'MP', address: 'Shiv Park' }
    const ok = createEditShopSchema.safeParse({ ...base, latitude: '23.256924', longitude: '77.472351' })
    expect(ok.success).toBe(true)
    expect(ok.data).toMatchObject({ latitude: 23.256924, longitude: 77.472351 })
    expect(createEditShopSchema.safeParse(base).success).toBe(true) // location optional for API compatibility
    expect(createEditShopSchema.safeParse({ ...base, latitude: '23.2' }).success).toBe(false)
    expect(createEditShopSchema.safeParse({ ...base, latitude: '0', longitude: '0' }).success).toBe(false)
    expect(createEditShopSchema.safeParse({ ...base, latitude: '123', longitude: '77' }).success).toBe(false)
  })

  it('the edit-shop page uses the map picker and sends the point', () => {
    const source = readFileSync(new URL('../src/pages/CreateEditShop.jsx', import.meta.url), 'utf8')
    expect(source).toContain('<LocationPicker value={point} onChange={onPlace} />')
    expect(source).toContain('formData.append("latitude",String(point.latitude))')
    expect(source).toContain('formData.append("longitude",String(point.longitude))')
  })
})
