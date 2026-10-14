import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { makeReadyForPickupHandler, makeResyncHandler } from '../src/utils/partnerEvents.js'

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
