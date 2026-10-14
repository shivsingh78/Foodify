import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { describeGeoError, makeOrdersRefetch, makeReadyForPickupHandler, makeResyncHandler, startLocationHeartbeat } from '../src/utils/partnerEvents.js'

describe('delivery dashboard reactions', () => {
  it('shows the alert and reloads the current delivery and offers as soon as the event arrives', async () => {
    const deps = { refreshCurrentOrder: vi.fn(async () => {}), refreshAssignments: vi.fn(async () => {}), setAlert: vi.fn() }
    await makeReadyForPickupHandler(deps)({ shopName: 'Pizza Place', orderId: 'o1' })
    expect(deps.setAlert).toHaveBeenCalledWith(expect.stringContaining('Pizza Place'))
    expect(deps.refreshCurrentOrder).toHaveBeenCalledTimes(1)
    expect(deps.refreshAssignments).toHaveBeenCalledTimes(1)
  })

  it('still works without a payload', async () => {
    const deps = { refreshCurrentOrder: vi.fn(async () => {}), refreshAssignments: vi.fn(async () => {}), setAlert: vi.fn() }
    await makeReadyForPickupHandler(deps)(undefined)
    expect(deps.setAlert).toHaveBeenCalledWith('Your order is ready for pickup.')
  })

  it('reloads offers, the active delivery and stats after a socket reconnect', async () => {
    const deps = { refreshCurrentOrder: vi.fn(async () => {}), refreshAssignments: vi.fn(async () => {}), refreshToday: vi.fn(async () => {}) }
    await makeResyncHandler(deps)()
    for (const fn of Object.values(deps)) expect(fn).toHaveBeenCalledTimes(1)
  })

  it('DelieveryBoy registers the event and the resync listener', () => {
    const source = readFileSync(new URL('../src/components/DelieveryBoy.jsx', import.meta.url), 'utf8')
    expect(source).toContain("useSocketEvent('deliveryReadyForPickup'")
    expect(source).toContain("'foodify:resync'")
    expect(source).toContain('makeReadyForPickupHandler')
  })
})

describe('stationary partner stays eligible', () => {
  it('re-sends the last known position on every interval and stops when asked', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const hb = startLocationHeartbeat({ emit, intervalMs: 30_000 })
    vi.advanceTimersByTime(60_000)
    expect(emit).not.toHaveBeenCalled() // nothing to send before the first position
    hb.update({ latitude: 19.2, longitude: 79.8 })
    expect(emit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(90_000)
    expect(emit).toHaveBeenCalledTimes(4)
    expect(emit).toHaveBeenLastCalledWith({ latitude: 19.2, longitude: 79.8 })
    hb.update({ latitude: 19.3, longitude: 79.9 })
    vi.advanceTimersByTime(30_000)
    expect(emit).toHaveBeenLastCalledWith({ latitude: 19.3, longitude: 79.9 })
    hb.stop()
    const calls = emit.mock.calls.length
    vi.advanceTimersByTime(120_000)
    expect(emit).toHaveBeenCalledTimes(calls)
    vi.useRealTimers()
  })

  it('beats the server freshness limit (120 s)', () => {
    vi.useFakeTimers()
    const stamps = []
    const hb = startLocationHeartbeat({ emit: () => stamps.push(Date.now()) })
    hb.update({ latitude: 1, longitude: 1 })
    vi.advanceTimersByTime(10 * 60_000)
    hb.stop()
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i])
    expect(Math.max(...gaps)).toBeLessThan(120_000)
    vi.useRealTimers()
  })

  it('wires the heartbeat into the dashboard', () => {
    const source = readFileSync(new URL('../src/components/DelieveryBoy.jsx', import.meta.url), 'utf8')
    expect(source).toContain('startLocationHeartbeat')
    expect(source).toContain('heartbeat.stop()')
  })
})

describe('restaurant order card', () => {
  it('reloads orders into the store when told, and survives a failed fetch', async () => {
    const setOrders = vi.fn()
    await makeOrdersRefetch({ fetchOrders: async () => [{ _id: 'o1' }], setOrders })()
    expect(setOrders).toHaveBeenCalledWith([{ _id: 'o1' }])
    const failing = vi.fn()
    await expect(makeOrdersRefetch({ fetchOrders: async () => { throw new Error('x') }, setOrders: failing })()).resolves.toBeUndefined()
    expect(failing).not.toHaveBeenCalled()
  })

  it('MyOrders listens for assignment and exhaustion events', () => {
    const source = readFileSync(new URL('../src/pages/MyOrders.jsx', import.meta.url), 'utf8')
    expect(source).toContain("useSocketEvent('deliveryAssigned'")
    expect(source).toContain("useSocketEvent('dispatchExhausted'")
  })
})


describe('geolocation failures are visible', () => {
  it('explains each browser error code', () => {
    expect(describeGeoError({ code: 1 })).toMatch(/permission/i)
    expect(describeGeoError({ code: 2 })).toMatch(/could not determine/i)
    expect(describeGeoError({ code: 3 })).toMatch(/timed out/i)
    expect(describeGeoError(undefined)).toMatch(/unavailable/i)
  })
  it('the dashboard renders the error instead of only logging it', () => {
    const source = readFileSync(new URL('../src/components/DelieveryBoy.jsx', import.meta.url), 'utf8')
    expect(source).toContain('setGeoError(describeGeoError(error))')
    expect(source).toContain('role="alert"')
  })
})

describe('restaurant can restart dispatch', () => {
  it('the order card offers "Find a delivery partner again" for unassigned orders and calls the retry endpoint', () => {
    const source = readFileSync(new URL('../src/components/OwnerOrderCard.jsx', import.meta.url), 'utf8')
    expect(source).toContain('Find a delivery partner again')
    expect(source).toContain('/api/order/retry-dispatch/${data._id}/${data.shopOrders._id}')
  })
})

describe('restaurant card: availability as counts only', async () => {
  const { describeDispatchSummary } = await import('../src/utils/dispatchSummary.js')
  it('describes each dispatch state without names or numbers of people', () => {
    expect(describeDispatchSummary(null)).toMatch(/Checking/)
    expect(describeDispatchSummary({ availablePartners: 2, offerPending: true, offerExpiresInSeconds: 18 })).toBe('2 delivery partners available nearby. Offer sent to a partner, waiting for them to accept (18s left).')
    expect(describeDispatchSummary({ availablePartners: 1, offerPending: false })).toBe('1 delivery partner available nearby. Sending an offer…')
    expect(describeDispatchSummary({ availablePartners: 0 })).toMatch(/No delivery partner available/)
    expect(describeDispatchSummary({ availablePartners: 1, searchStopped: true })).toMatch(/Find a delivery partner again/)
  })
  it('the order card uses the summary endpoint and no longer lists partner names', () => {
    const source = readFileSync(new URL('../src/components/OwnerOrderCard.jsx', import.meta.url), 'utf8')
    expect(source).toContain('/api/order/dispatch-summary/')
    expect(source).toContain('describeDispatchSummary(summary)')
    expect(source).not.toContain('availableBoys')
  })
})
