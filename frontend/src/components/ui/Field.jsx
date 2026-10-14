import { useId } from 'react'

/** Label + input pair with an accessible association and optional error text. */
function Field({ label, error, children, ...inputProps }) {
  const id = useId()
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">{label}</label>
      {children ? children(id) : <input id={id} className="input" aria-invalid={Boolean(error)} {...inputProps} />}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  )
}

export default Field
