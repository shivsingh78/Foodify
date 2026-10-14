import { describe, expect, it, vi } from 'vitest'

const handlers = {}
const fake = { on: vi.fn((e, h) => (handlers[e] = h)), off: vi.fn(), removeAllListeners: vi.fn(), disconnect: vi.fn(), io: { on: vi.fn(), removeAllListeners: vi.fn() } }
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fake) }))

import { connectSocket, disconnectSocket } from '../src/utils/socket.js'
import { store } from '../src/redux/store.js'

describe('socket singleton', () => {
  it('reuses one connection, cleans up on disconnect, and never enters Redux state', async () => {
    const { io } = await import('socket.io-client')
    expect(connectSocket()).toBe(connectSocket())
    expect(io).toHaveBeenCalledTimes(1)
    expect(io.mock.calls[0][1]).toMatchObject({ withCredentials: true })
    expect(JSON.stringify(Object.keys(store.getState().user))).not.toContain('socket')
    disconnectSocket()
    expect(fake.disconnect).toHaveBeenCalled()
    connectSocket()
    expect(io).toHaveBeenCalledTimes(2)
    disconnectSocket()
  })
})
