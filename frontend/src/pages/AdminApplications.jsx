import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IoIosArrowRoundBack } from 'react-icons/io'
import { fetchAdminApplications, reviewApplication, ROLE_LABEL, STATUS_LABEL, STATUS_STYLE } from '../utils/applications'
import { getErrorMessage } from '../utils/api'

function Detail({ app }) {
  const d = app.ownerData ?? app.deliveryData
  const rows = app.role === 'owner'
    ? [['Restaurant', d.businessName], ['Description', d.description], ['Phone', d.contactPhone], ['Address', `${d.address}, ${d.city}, ${d.state}`], ['Coordinates', `${d.latitude}, ${d.longitude}`]]
    : [['Phone', d.contactPhone], ['Vehicle', d.vehicleType], ['Registration', d.vehicleNumber], ['Service area', d.serviceArea]]
  return (
    <div className="mt-3 border-t border-line pt-3 text-sm">
      <p className="text-muted">Applicant: <span className="text-ink">{app.user?.fullName} · {app.user?.email}</span></p>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {rows.filter(([, v]) => v).map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>))}
      </dl>
      {d.image && <img src={d.image} alt="Restaurant" className="mt-3 h-32 w-full max-w-xs rounded-lg object-cover" />}
      {app.reviewNote && <p className="mt-2 text-muted">Note: <span className="text-ink">{app.reviewNote}</span></p>}
      {app.provisioning?.state === 'failed' && <p className="alert-error mt-2">Last approval attempt failed ({app.provisioning.error}). Retry approval or reject.</p>}
    </div>
  )
}

function AdminApplications() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ status: 'pending', role: '', q: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [reason, setReason] = useState({ id: null, action: null, text: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const params = { page, limit: 10, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }
      setData(await fetchAdminApplications(params)); setErr('')
    } catch (e) { setErr(getErrorMessage(e)) }
  }, [filters, page])
  useEffect(() => { load() }, [load])

  const run = async (id, action, text) => {
    setBusy(true); setErr('')
    try { await reviewApplication(id, action, text); setReason({ id: null, action: null, text: '' }); await load() }
    catch (e) { setErr(getErrorMessage(e)) }
    finally { setBusy(false) }
  }
  const setFilter = (k) => (e) => { setPage(1); setFilters((f) => ({ ...f, [k]: e.target.value })) }

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto w-full max-w-4xl">
        <button type="button" onClick={() => navigate('/')} className="mb-4 flex items-center gap-1 text-sm text-muted hover:text-ink"><IoIosArrowRoundBack size={22} /> Back</button>
        <h1 className="mb-4 text-2xl font-bold text-ink">Role applications</h1>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <select aria-label="Status" className="input" value={filters.status} onChange={setFilter('status')}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label="Role" className="input" value={filters.role} onChange={setFilter('role')}>
            <option value="">All roles</option>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input aria-label="Search applicant" className="input" placeholder="Search name or email" value={filters.q} onChange={setFilter('q')} />
        </div>
        {err && <p role="alert" className="alert-error mb-3">{err}</p>}
        {!data && !err && <div className="skeleton h-24" />}
        {data?.applications.length === 0 && <p className="py-8 text-center text-sm text-muted">No applications match these filters.</p>}

        <ul className="space-y-3">
          {data?.applications.map((a) => (
            <li key={a._id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{a.user?.fullName} <span className="font-normal text-muted">· {ROLE_LABEL[a.role]}</span></p>
                  <p className="text-xs text-muted">{a.user?.email} · {new Date(a.submittedAt).toLocaleString()}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpenId(openId === a._id ? null : a._id)}>{openId === a._id ? 'Hide' : 'View'}</button>
                {a.status === 'pending' && (<>
                  <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy} onClick={() => run(a._id, 'approve')}>Approve</button>
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={() => setReason({ id: a._id, action: 'request-info', text: '' })}>Request info</button>
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm text-danger" disabled={busy} onClick={() => setReason({ id: a._id, action: 'reject', text: '' })}>Reject</button>
                </>)}
              </div>
              {openId === a._id && <Detail app={a} />}
              {reason.id === a._id && (
                <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); run(a._id, reason.action, reason.text) }}>
                  <label className="block text-sm font-medium text-ink" htmlFor={`r-${a._id}`}>{reason.action === 'reject' ? 'Rejection reason (shown to the applicant)' : 'What information is needed?'}</label>
                  <textarea id={`r-${a._id}`} className="input" rows={3} minLength={5} maxLength={500} required value={reason.text} onChange={(e) => setReason((r) => ({ ...r, text: e.target.value }))} />
                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary px-3 py-1.5 text-sm" disabled={busy || reason.text.trim().length < 5}>Confirm</button>
                    <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setReason({ id: null, action: null, text: '' })}>Cancel</button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>

        {data && data.pagination.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="text-muted">Page {data.pagination.page} of {data.pagination.totalPages}</span>
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={!data.pagination.hasNextPage} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminApplications
