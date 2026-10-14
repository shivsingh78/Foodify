import { FiMoon, FiSun } from 'react-icons/fi'
import { useTheme } from '../theme/useTheme'

/**
 * Light/dark switch. Reads and writes the single shared theme store, so it can be placed in any layout
 * (navigation, auth screens, floating) without duplicating state. The label always names the action.
 */
function ThemeToggle({ className = '' }) {
  const { isDark, toggle } = useTheme()
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button type="button" onClick={toggle} className={`icon-btn shrink-0 ${className}`} aria-label={label} title={label}>
      {isDark ? <FiSun size={20} aria-hidden="true" /> : <FiMoon size={20} aria-hidden="true" />}
    </button>
  )
}

export default ThemeToggle
