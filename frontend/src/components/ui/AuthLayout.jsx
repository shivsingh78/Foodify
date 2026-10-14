import logo from '../../assets/logo.jpg'
import ThemeToggle from '../ThemeToggle'

/** Shared shell for sign-in, sign-up and password-reset screens. */
function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src={logo} alt="" className="h-10 w-10 rounded-lg border border-line object-cover" />
          <h1 className="text-2xl font-bold text-brand-brown">Foodify</h1>
          <ThemeToggle className="ml-auto" />
        </div>
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mb-6 mt-1 text-sm text-muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}

export default AuthLayout
