import { useState } from 'react'
import { IoIosArrowRoundBack } from 'react-icons/io'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import ClipLoader from 'react-spinners/ClipLoader'
import { sendOtpSchema, verifyOtpSchema, resetPasswordSchema } from '@foodify/validation'
import { serverUrl } from '../config'
import { getErrorMessage } from '../utils/api'
import AuthLayout from '../components/ui/AuthLayout'
import Field from '../components/ui/Field'
import PasswordInput from '../components/ui/PasswordInput'

const post = (path, body) => axios.post(`${serverUrl}/api/auth/${path}`, body, { withCredentials: true })

function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const run = (schema, payload, request, onSuccess) => async (e) => {
    e.preventDefault()
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? 'Invalid input')
    setLoading(true)
    try {
      const { data } = await request(parsed.data)
      setErr('')
      onSuccess(data)
    } catch (error) {
      setErr(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const submitLabel = (text) => (loading ? <ClipLoader color="white" size={20} /> : text)

  return (
    <AuthLayout title="Reset your password">
      <button type="button" onClick={() => navigate('/signin')} className="-mt-2 mb-4 flex items-center gap-1 text-sm text-muted hover:text-ink">
        <IoIosArrowRoundBack size={22} /> Back to sign in
      </button>

      {step === 1 && (
        <form noValidate onSubmit={run(sendOtpSchema, { email }, (d) => post('send-otp', d), () => { setInfo('If an account exists for this email, we sent a 6-digit code.'); setStep(2) })}>
          <Field label="Email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {err && <p role="alert" className="alert-error mb-4">{err}</p>}
          <button type="submit" className="btn-primary w-full" disabled={loading}>{submitLabel('Send code')}</button>
        </form>
      )}

      {step === 2 && (
        <form noValidate onSubmit={run(verifyOtpSchema, { email, otp }, (d) => post('verify-otp', d), (data) => { setResetToken(data.resetToken); setInfo(''); setStep(3) })}>
          {info && <p className="alert-success mb-4">{info}</p>}
          <Field label="6-digit code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="123456" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
          {err && <p role="alert" className="alert-error mb-4">{err}</p>}
          <button type="submit" className="btn-primary w-full" disabled={loading}>{submitLabel('Verify code')}</button>
        </form>
      )}

      {step === 3 && (
        <form
          noValidate
          onSubmit={(e) => {
            if (newPassword !== confirmPassword) {
              e.preventDefault()
              return setErr('Passwords do not match')
            }
            return run(resetPasswordSchema, { email, newPassword, resetToken }, (d) => post('reset-password', d), () => navigate('/signin'))(e)
          }}
        >
          <Field label="New password">
            {(id) => <PasswordInput id={id} autoComplete="new-password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />}
          </Field>
          <Field label="Confirm password">
            {(id) => <PasswordInput id={id} autoComplete="new-password" placeholder="Repeat the password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />}
          </Field>
          {err && <p role="alert" className="alert-error mb-4">{err}</p>}
          <button type="submit" className="btn-primary w-full" disabled={loading}>{submitLabel('Reset password')}</button>
        </form>
      )}
    </AuthLayout>
  )
}

export default ForgotPassword
