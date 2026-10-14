import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ClipLoader from 'react-spinners/ClipLoader'
import { ownerApplicationSchema } from '@foodify/validation'
import AuthLayout from '../components/ui/AuthLayout'
import Field from '../components/ui/Field'
import LocationPicker from '../components/LocationPicker'
import { fetchMyApplications, submitOwnerApplication } from '../utils/applications'
import { getErrorMessage } from '../utils/api'

const empty = { businessName: '', description: '', contactPhone: '', address: '', city: '', state: '' }

/** Also used to answer a "more information needed" request: /become-owner?resubmit=<id>. */
function BecomeOwner() {
  const navigate = useNavigate()
  const resubmitId = useSearchParams()[0].get('resubmit')
  const [form, setForm] = useState(empty)
  const [point, setPoint] = useState(null)
  const [image, setImage] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!resubmitId) return
    fetchMyApplications().then((apps) => {
      const d = apps.find((a) => a._id === resubmitId && a.status === 'needs_info')?.ownerData
      if (!d) return
      const { latitude, longitude, image: _image, ...rest } = d
      setForm({ ...empty, ...rest })
      setPoint({ latitude, longitude })
    }).catch(() => undefined)
  }, [resubmitId])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const onPlace = (p) => {
    setPoint({ latitude: p.latitude, longitude: p.longitude })
    setForm((f) => ({ ...f, address: p.formatted || f.address, city: p.city || f.city, state: p.state || f.state }))
  }

  const submit = async (e) => {
    e.preventDefault()
    const payload = { ...form, latitude: point?.latitude, longitude: point?.longitude }
    if (!point) return setErr('Select the restaurant location on the map.')
    const parsed = ownerApplicationSchema.safeParse(payload)
    if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? 'Invalid details')
    if (!image && !resubmitId) return setErr('Add a photo of your restaurant.')
    setLoading(true)
    try {
      await submitOwnerApplication(parsed.data, image, resubmitId)
      navigate('/my-applications')
    } catch (error) {
      setErr(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Become a restaurant owner" subtitle="Tell us about your restaurant. An administrator reviews every application; owner tools unlock only after approval.">
      <form onSubmit={submit} noValidate>
        <Field label="Restaurant name" value={form.businessName} onChange={set('businessName')} required />
        <Field label="Description (optional)" value={form.description} onChange={set('description')} />
        <Field label="Contact phone" type="tel" autoComplete="tel" value={form.contactPhone} onChange={set('contactPhone')} required />
        <div className="mb-4">
          <p className="mb-1 text-sm font-medium text-ink">Location</p>
          <LocationPicker value={point} onChange={onPlace} />
        </div>
        <Field label="Address" value={form.address} onChange={set('address')} required />
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" value={form.city} onChange={set('city')} required />
          <Field label="State" value={form.state} onChange={set('state')} required />
        </div>
        <Field label={resubmitId ? 'Restaurant photo (leave empty to keep the current one)' : 'Restaurant photo'}>
          {(id) => <input id={id} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="input" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />}
        </Field>
        <p className="mb-4 text-xs text-muted">The photo becomes your public restaurant image. Do not upload identity documents here.</p>
        {err && <p role="alert" className="alert-error mb-4">{err}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? <ClipLoader color="white" size={20} /> : resubmitId ? 'Resubmit application' : 'Submit application'}</button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={() => navigate('/my-applications')}>Cancel</button>
      </form>
    </AuthLayout>
  )
}

export default BecomeOwner
