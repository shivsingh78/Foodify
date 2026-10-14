import axios from 'axios'
import { useCallback, useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { serverUrl } from '../config'
import { useSocketEvent } from '../utils/socket'

/** Persistent in-app notifications with realtime push and refetch on reconnect. */
function useNotifications() {
  const { userData } = useSelector((state) => state.user)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!userData) return
    setLoading(true)
    try {
      const { data } = await axios.get(`${serverUrl}/api/notifications`, { params: { limit: 20 }, withCredentials: true })
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
    } catch {
      // Notifications are non-critical; keep the previous list.
    } finally {
      setLoading(false)
    }
  }, [userData])

  useEffect(() => {
    refresh()
    window.addEventListener('foodify:resync', refresh)
    return () => window.removeEventListener('foodify:resync', refresh)
  }, [refresh])

  useSocketEvent('notification', (n) => {
    setNotifications((prev) => [n, ...prev].slice(0, 20))
    setUnreadCount((c) => c + 1)
  })

  const markRead = async (id) => {
    await axios.post(`${serverUrl}/api/notifications/${id}/read`, {}, { withCredentials: true })
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, read: true } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
  }

  const markAllRead = async () => {
    await axios.post(`${serverUrl}/api/notifications/read-all`, {}, { withCredentials: true })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  return { notifications, unreadCount, loading, markRead, markAllRead }
}

export default useNotifications
