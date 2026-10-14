import { useState } from 'react'
import { FcGoogle } from 'react-icons/fc'
import ClipLoader from 'react-spinners/ClipLoader'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useDispatch } from 'react-redux'
import { signInSchema } from '@foodify/validation'
import { serverUrl } from '../config'
import { logAuthErrorInDev, signInWithGoogle } from '../utils/googleAuth'
import { getErrorMessage, getGoogleErrorMessage } from '../utils/api'
import { setUserData } from '../redux/userSlice'
import AuthLayout from '../components/ui/AuthLayout'
import Field from '../components/ui/Field'
import PasswordInput from '../components/ui/PasswordInput'

function SignIn() {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [form, setForm] = useState({ email: '', password: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSignIn = async (e) => {
    e.preventDefault()
    const parsed = signInSchema.safeParse(form)
    if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? 'Invalid details')
    setLoading(true)
    try {
      const { data } = await axios.post(`${serverUrl}/api/auth/signin`, parsed.data, { withCredentials: true })
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
    setGoogleLoading(true)
    try {
      const result = await signInWithGoogle()
      if (!result) return
      const idToken = await result.user.getIdToken()
      const { data } = await axios.post(`${serverUrl}/api/auth/google-signin`, { idToken }, { withCredentials: true })
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
    <AuthLayout title="Welcome back" subtitle="Sign in to order your favourite food.">
      <form onSubmit={handleSignIn} noValidate>
        <Field label="Email" type="email" placeholder="you@example.com" autoComplete="email" value={form.email} onChange={update('email')} required />
        <Field label="Password">
          {(id) => <PasswordInput id={id} placeholder="Your password" autoComplete="current-password" value={form.password} onChange={update('password')} required />}
        </Field>

        <div className="mb-4 text-right">
          <button type="button" onClick={() => navigate('/forgot-password')} className="text-sm font-medium text-brand hover:underline">
            Forgot password?
          </button>
        </div>

        {err && <p role="alert" className="alert-error mb-4">{err}</p>}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? <ClipLoader color="white" size={20} /> : 'Sign in'}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      <button type="button" className="btn-secondary w-full" onClick={handleGoogleAuth} disabled={googleLoading}>
        <FcGoogle size={20} />
        <span>{googleLoading ? 'Signing in…' : 'Sign in with Google'}</span>
      </button>

      <p className="mt-6 text-center text-sm text-muted">
        New to Foodify?{' '}
        <button type="button" onClick={() => navigate('/signup')} className="font-semibold text-brand hover:underline">
          Create an account
        </button>
      </p>
    </AuthLayout>
  )
}

export default SignIn
