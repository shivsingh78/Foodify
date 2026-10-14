import { useState } from 'react'
import { FaRegEye, FaRegEyeSlash } from 'react-icons/fa'

function PasswordInput({ id, ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input id={id} type={visible ? 'text' : 'password'} className="input pr-10" {...props} />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <FaRegEyeSlash /> : <FaRegEye />}
      </button>
    </div>
  )
}

export default PasswordInput
