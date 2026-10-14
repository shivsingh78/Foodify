import { useState } from 'react'
import { FcGoogle } from 'react-icons/fc'
import ClipLoader from 'react-spinners/ClipLoader'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useDispatch } from 'react-redux'
import { signUpSchema, mobileSchema } from '@foodify/validation'
import { serverUrl } from '../config'
import { logAuthErrorInDev, signInWithGoogle } from '../utils/googleAuth'
import { getErrorMessage, getGoogleErrorMessage } from '../utils/api'
import { setUserData } from '../redux/userSlice'
import AuthLayout from '../components/ui/AuthLayout'
import Field from '../components/ui/Field'
import PasswordInput from '../components/ui/PasswordInput'

function SignUp() {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [form, setForm] = useState({ fullName: '', email: '', mobile: '', password: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSignUp = async (e) => {
    e.preventDefault()
    const parsed = signUpSchema.safeParse(form)
    if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? 'Invalid details')
    setLoading(true)
    try {
      const { data } = await axios.post(`${serverUrl}/api/auth/signup`, parsed.data, { withCredentials: true })
      setErr('')
      dispatch(setUserData(data))
    } catch (error) {
      setErr(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleAuth = async () => {
    if (googleLoading) return
    // Mobile is optional for Google; when given it must still be valid.
    const mobile = form.mobile.trim() ? mobileSchema.safeParse(form.mobile) : { success: true, data: undefined }
    if (!mobile.success) return setErr('Enter a valid mobile number or leave it empty')
    setGoogleLoading(true)
    try {
      const result = await signInWithGoogle()
      if (!result) return
      // The server verifies this token and derives name/email from it.
      const idToken = await result.user.getIdToken()
      const { data } = await axios.post(
        `${serverUrl}/api/auth/google-signup`,
        { idToken, ...(mobile.data && { mobile: mobile.data }) },
        { withCredentials: true },
      )
      setErr('')
      dispatch(setUserData(data))
    } catch (error) {
      logAuthErrorInDev('google-auth', error)
      setErr(getGoogleErrorMessage(error))
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Get started with delicious food deliveries.">
      <form onSubmit={handleSignUp} noValidate>
        <Field label="Full name" placeholder="Your full name" autoComplete="name" value={form.fullName} onChange={update('fullName')} required />
        <Field label="Email" type="email" placeholder="you@example.com" autoComplete="email" value={form.email} onChange={update('email')} required />
        <Field label="Mobile" type="tel" placeholder="10-digit mobile number" autoComplete="tel" value={form.mobile} onChange={update('mobile')} required />
        <Field label="Password">
          {(id) => <PasswordInput id={id} placeholder="At least 8 characters" autoComplete="new-password" value={form.password} onChange={update('password')} required />}
        </Field>

        {err && <p role="alert" className="alert-error mb-4">{err}</p>}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? <ClipLoader color="white" size={20} /> : 'Sign up'}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      <button type="button" className="btn-secondary w-full" onClick={handleGoogleAuth} disabled={googleLoading}>
        <FcGoogle size={20} />
        <span>{googleLoading ? 'Signing up…' : 'Sign up with Google'}</span>
      </button>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <button type="button" onClick={() => navigate('/signin')} className="font-semibold text-brand hover:underline">
          Sign in
        </button>
      </p>
    </AuthLayout>
  )
}

export default SignUp
