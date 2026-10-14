import { describe, expect, it } from 'vitest'
import { readPublicConfig, resolveServerUrl } from '../src/runtimeConfig.js'
import { buildFirebaseConfig } from '../src/utils/firebaseConfig.js'

describe('runtime public config', () => {
  it('prefers runtime values and falls back to build-time env', () => {
    const cfg = readPublicConfig(
      { VITE_FIREBASE_APIKEY: 'dev-key', VITE_RAZORPAY_KEY_ID: 'rzp_dev' },
      { VITE_FIREBASE_APIKEY: 'prod-key', VITE_FIREBASE_PROJECT_ID: 'proj' },
    )
    expect(cfg).toEqual({ VITE_FIREBASE_APIKEY: 'prod-key', VITE_FIREBASE_PROJECT_ID: 'proj', VITE_RAZORPAY_KEY_ID: 'rzp_dev' })
  })

  it('ignores unknown keys and empty values', () => {
    expect(readPublicConfig({ JWT_SECRET: 'x', VITE_API_URL: '' }, { MONGODB_URL: 'y' })).toEqual({})
  })

  it('uses the same origin when VITE_API_URL is empty or unset', () => {
    expect(resolveServerUrl(readPublicConfig({}, {}))).toBe('')
    expect(resolveServerUrl({ VITE_API_URL: 'https://api.example.com/' })).toBe('https://api.example.com')
  })

  it('still validates the Firebase config with a helpful message', () => {
    expect(() => buildFirebaseConfig(readPublicConfig({}, {}))).toThrow(/runtime environment/)
    expect(buildFirebaseConfig({ VITE_FIREBASE_APIKEY: 'k', VITE_FIREBASE_PROJECT_ID: 'p' }).authDomain).toBe('p.firebaseapp.com')
  })
})
