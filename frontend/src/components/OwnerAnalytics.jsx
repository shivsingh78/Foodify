import axios from 'axios'
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { serverUrl } from '../config'
import { getErrorMessage } from '../utils/api'

const RANGES = [7, 30, 90]
const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-surface-muted p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-bold text-ink">{value}</p>
    </div>
  )
}

/** Owner sales dashboard backed by /api/analytics/owner (MongoDB aggregation). */
function OwnerAnalytics() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    axios
      .get(`${serverUrl}/api/analytics/owner`, { params: { days }, withCredentials: true })
      .then((res) => !cancelled && (setData(res.data), setError('')))
      .catch((e) => !cancelled && setError(getErrorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [days])

  return (
    <section className="card w-full max-w-3xl p-4 sm:p-6" aria-labelledby="analytics-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="analytics-heading" className="text-lg font-semibold text-ink">Sales overview</h2>
        <div className="flex gap-1" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              aria-pressed={days === r}
              className={`rounded-full px-3 py-1 text-sm ${days === r ? 'bg-primary text-white' : 'bg-surface-muted text-ink'}`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="alert-error">{error}</p>}
      {loading && !data && <div className="skeleton h-40" />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Revenue" value={money(data.totalRevenue)} />
            <Stat label="Orders" value={`${data.completedOrders}/${data.totalOrders} done`} />
            <Stat label="Avg order" value={money(data.averageOrderValue)} />
            <Stat label="Cancelled" value={`${data.cancellationRate}%`} />
          </div>

          {data.totalOrders === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No orders in this period yet.</p>
          ) : (
            <>
              <h3 className="mb-2 mt-6 text-sm font-semibold text-ink">Revenue by day</h3>
              <div className="h-56 w-full">
                {data.revenueByDay.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">No delivered orders yet.</p>
                ) : (
                  <ResponsiveContainer>
                    <BarChart data={data.revenueByDay}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v) => money(v)} />
                      <Bar dataKey="revenue" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Orders by status</h3>
                  <ul className="space-y-1 text-sm">
                    {data.ordersByStatus.map((s) => (
                      <li key={s.status} className="flex justify-between">
                        <span className="capitalize text-muted">{s.status}</span>
                        <span className="font-medium text-ink">{s.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Top products</h3>
                  <ol className="space-y-1 text-sm">
                    {data.topProducts.map((p) => (
                      <li key={String(p.itemId)} className="flex justify-between gap-2">
                        <span className="truncate text-muted">{p.name}</span>
                        <span className="font-medium text-ink">{p.quantity} sold · {money(p.revenue)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

export default OwnerAnalytics
