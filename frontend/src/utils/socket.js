import { useEffect, useRef, useSyncExternalStore } from 'react'
import { io } from 'socket.io-client'
import { serverUrl } from '../config'

/**
 * Module-level Socket.IO singleton. The live socket is deliberately NOT kept in Redux
 * (it is not serializable). The server authenticates it from the httpOnly session cookie.
 */
let socket = null
const listeners = new Set()
const notify = () => listeners.forEach((l) => l())

export const connectSocket = () => {
  if (socket) return socket
  socket = io(serverUrl || undefined, { withCredentials: true })
  // Events are not replayed after a reconnect; tell the data hooks to refetch from the API.
  socket.io.on('reconnect', () => window.dispatchEvent(new Event('foodify:resync')))
  notify()
  return socket
}

export const disconnectSocket = () => {
  if (!socket) return
  socket.removeAllListeners()
  socket.io.removeAllListeners()
  socket.disconnect()
  socket = null
  notify()
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current socket instance (null while signed out); re-renders when it changes. */
export const useSocket = () => useSyncExternalStore(subscribe, () => socket)

/**
 * Subscribes to a socket event for the component's lifetime. The handler may close over
 * fresh props/state: the latest one is always called, and only this handler is removed on cleanup.
 */
export const useSocketEvent = (event, handler) => {
  const socketInstance = useSocket()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!socketInstance) return
    const listener = (...args) => handlerRef.current(...args)
    socketInstance.on(event, listener)
    return () => socketInstance.off(event, listener)
  }, [socketInstance, event])
}
