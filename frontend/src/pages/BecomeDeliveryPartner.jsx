import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ClipLoader from 'react-spinners/ClipLoader'
import { deliveryApplicationSchema, VEHICLE_TYPES } from '@foodify/validation'
import AuthLayout from '../components/ui/AuthLayout'
import Field from '../components/ui/Field'
import { fetchMyApplications, submitDeliveryApplication } from '../utils/applications'
import { getErrorMessage } from '../utils/api'

const empty = { contactPhone: '', vehicleType: 'motorcycle', vehicleNumber: '', serviceArea: '' }

function BecomeDeliveryPartner() {
  const navigate = useNavigate()
  const resubmitId = useSearchParams()[0].get('resubmit')
  const [form, setForm] = useState(empty)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!resubmitId) return
    fetchMyApplications().then((apps) => {
      const d = apps.find((a) => a._id === resubmitId && a.status === 'needs_info')?.deliveryData
      if (d) setForm({ ...empty, ...d })
    }).catch(() => undefined)
  }, [resubmitId])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const motorised = form.vehicleType !== 'bicycle'

  const submit = async (e) => {
    e.preventDefault()
    const payload = { ...form, vehicleNumber: motorised ? form.vehicleNumber : undefined }
    const parsed = deliveryApplicationSchema.safeParse(payload)
    if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? 'Invalid details')
    setLoading(true)
    try {
      await submitDeliveryApplication(parsed.data, resubmitId)
      navigate('/my-applications')
    } catch (error) {
      setErr(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Become a delivery partner" subtitle="We only ask for what is needed to assign deliveries. An administrator reviews every application.">
      <form onSubmit={submit} noValidate>
        <Field label="Contact phone (customers and restaurants may call this)" type="tel" autoComplete="tel" value={form.contactPhone} onChange={set('contactPhone')} required />
        <Field label="Vehicle type">
          {(id) => (
            <select id={id} className="input" value={form.vehicleType} onChange={set('vehicleType')}>
              {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
            </select>
          )}
        </Field>
        {motorised && <Field label="Vehicle registration number (used to identify you on deliveries)" value={form.vehicleNumber} onChange={set('vehicleNumber')} required />}
        <Field label="City / district you deliver in (e.g. Bhopal). You get orders from restaurants in this city, plus any restaurant close to you" value={form.serviceArea} onChange={set('serviceArea')} required />
        {err && <p role="alert" className="alert-error mb-4">{err}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? <ClipLoader color="white" size={20} /> : resubmitId ? 'Resubmit application' : 'Submit application'}</button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={() => navigate('/my-applications')}>Cancel</button>
      </form>
    </AuthLayout>
  )
}

export default BecomeDeliveryPartner
