import { useState } from 'react'
import { FiBell } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import useNotifications from '../hooks/useNotifications'

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications()

  const openNotification = async (n) => {
    if (!n.read) await markRead(n._id).catch(() => undefined)
    setOpen(false)
    if (n.data?.orderId) navigate('/my-orders')
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="relative rounded-full p-2 text-brand hover:bg-primary-soft"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
      >
        <FiBell size={22} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="card fixed right-2 top-[76px] z-[10000] w-[min(92vw,22rem)] overflow-hidden sm:absolute sm:right-0 sm:top-12">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold text-ink">Notifications</h2>
            {unreadCount > 0 && (
              <button type="button" onClick={() => markAllRead()} className="text-sm font-medium text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {loading && notifications.length === 0 && <li className="skeleton m-3 h-12" />}
            {!loading && notifications.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</li>
            )}
            {notifications.map((n) => (
              <li key={n._id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={`block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-muted ${n.read ? '' : 'bg-primary-soft'}`}
                >
                  <p className="text-sm font-semibold text-ink">{n.title}</p>
                  <p className="text-sm text-muted">{n.message}</p>
                  <p className="mt-1 text-xs text-muted">{new Date(n.createdAt).toLocaleString()}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default NotificationBell
