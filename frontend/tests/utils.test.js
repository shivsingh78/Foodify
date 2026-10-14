import { describe, expect, it } from 'vitest'
import { getGoogleErrorMessage } from '../src/utils/api.js'
import { geoErrorMessage, geolocationErrorMessage } from '../src/utils/geo.js'
import { toGeoJsonPoint } from '@foodify/validation'

describe('Firebase error messages', () => {
  it('explains an invalid continue URL as a code problem, not a domain problem', () => {
    const msg = getGoogleErrorMessage({ code: 'auth/invalid-continue-uri' }, 'http://localhost:5173')
    expect(msg).toMatch(/redirect URL .* invalid/i)
    expect(msg).not.toMatch(/authorized domain/i)
  })
  it('names the offending origin for unauthorized domains', () => {
    for (const code of ['auth/unauthorized-continue-uri', 'auth/unauthorized-domain']) {
      expect(getGoogleErrorMessage({ code }, 'http://localhost:5173')).toContain('http://localhost:5173')
    }
  })
  it('stays silent when the user closes the popup', () => {
    expect(getGoogleErrorMessage({ code: 'auth/popup-closed-by-user' })).toBe('')
  })
  it('prefers the server message for API errors', () => {
    expect(getGoogleErrorMessage({ response: { data: { message: 'Account not found' } } })).toBe('Account not found')
  })
})

describe('geo helpers', () => {
  it('maps API and geolocation failures to distinct messages', () => {
    expect(geoErrorMessage({ response: { status: 429 } })).toMatch(/too many/i)
    expect(geoErrorMessage({ response: { status: 503 } })).toMatch(/not available/i)
    expect(geoErrorMessage({ response: { status: 504 } })).toMatch(/timed out/i)
    expect(geolocationErrorMessage({ code: 1 })).toMatch(/denied/i)
    expect(geolocationErrorMessage({ code: 3 })).toMatch(/timed out/i)
  })
  it('keeps GeoJSON in [longitude, latitude] order', () => {
    expect(toGeoJsonPoint(18.52, 73.85).coordinates).toEqual([73.85, 18.52])
  })
})

import { buildFirebaseConfig } from '../src/utils/firebaseConfig.js'

describe('firebase config', () => {
  it('derives the auth domain from the project id so they cannot drift apart', () => {
    expect(buildFirebaseConfig({ VITE_FIREBASE_APIKEY: 'k', VITE_FIREBASE_PROJECT_ID: 'my-proj' })).toEqual({
      apiKey: 'k', projectId: 'my-proj', authDomain: 'my-proj.firebaseapp.com',
    })
  })
  it('fails loudly when the project is not configured', () => {
    expect(() => buildFirebaseConfig({ VITE_FIREBASE_APIKEY: 'k' })).toThrow(/VITE_FIREBASE_PROJECT_ID/)
  })
})
