import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { IoIosArrowRoundBack } from 'react-icons/io'
import { fetchMyApplications, ROLE_LABEL, STATUS_LABEL, STATUS_STYLE } from '../utils/applications'
import { getErrorMessage } from '../utils/api'

const FORM_PATH = { owner: '/become-owner', deliveryBoy: '/become-delivery-partner' }
const NEXT_STEP = {
  pending: 'An administrator is reviewing your application. You will get a notification when it is decided. Privileged features stay locked until then.',
  needs_info: 'The reviewer needs more information. Update your application and resubmit it.',
  approved: 'You are approved. Reload the page (or sign in again) to see your new dashboard.',
  rejected: 'You can correct the issues and apply again.',
}

function MyApplications() {
  const navigate = useNavigate()
  const { userData } = useSelector((s) => s.user)
  const [apps, setApps] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetchMyApplications().then(setApps).catch((e) => setErr(getErrorMessage(e)))
  }, [])

  const open = apps?.some((a) => a.status === 'pending' || a.status === 'needs_info')
  const canApply = userData.role === 'user' && apps && !open

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto w-full max-w-2xl">
        <button type="button" onClick={() => navigate('/')} className="mb-4 flex items-center gap-1 text-sm text-muted hover:text-ink">
          <IoIosArrowRoundBack size={22} /> Back
        </button>
        <h1 className="mb-4 text-2xl font-bold text-ink">Partner applications</h1>
        {err && <p role="alert" className="alert-error">{err}</p>}
        {!apps && !err && <div className="skeleton h-24" />}

        {canApply && (
          <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2">
            <button type="button" className="btn-primary" onClick={() => navigate('/become-owner')}>Apply as restaurant owner</button>
            <button type="button" className="btn-secondary" onClick={() => navigate('/become-delivery-partner')}>Apply as delivery partner</button>
          </div>
        )}
        {apps?.length === 0 && <p className="text-sm text-muted">You have not applied yet.</p>}

        <ul className="space-y-3">
          {apps?.map((a) => (
            <li key={a._id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-ink">{ROLE_LABEL[a.role]}</h2>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
              </div>
              <p className="mt-1 text-xs text-muted">Submitted {new Date(a.submittedAt).toLocaleString()}{a.reviewedAt && ` · Reviewed ${new Date(a.reviewedAt).toLocaleString()}`}</p>
              {a.reviewNote && a.status !== 'approved' && (
                <p className="mt-3 rounded-lg bg-surface-muted p-3 text-sm text-ink"><span className="font-medium">{a.status === 'rejected' ? 'Reason: ' : 'Reviewer asks: '}</span>{a.reviewNote}</p>
              )}
              <p className="mt-3 text-sm text-muted">{NEXT_STEP[a.status]}</p>
              {a.status === 'needs_info' && (
                <button type="button" className="btn-primary mt-3" onClick={() => navigate(`${FORM_PATH[a.role]}?resubmit=${a._id}`)}>Update and resubmit</button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default MyApplications
