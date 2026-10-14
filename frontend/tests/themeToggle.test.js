import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

describe('theme switch placement and accessibility', () => {
  it('is an icon button whose accessible name always states the action', () => {
    const t = src('components/ThemeToggle.jsx')
    expect(t).toContain("'Switch to light mode'")
    expect(t).toContain("'Switch to dark mode'")
    expect(t).toContain('aria-label={label}')
    expect(t).toContain('FiSun')
    expect(t).toContain('FiMoon')
    expect(t).toContain('type="button"')
  })

  it('appears in the navigation and on the auth screens, and floats on every other page (never twice)', () => {
    expect(src('components/Nav.jsx')).toContain('<ThemeToggle />')
    expect(src('components/ui/AuthLayout.jsx')).toContain('<ThemeToggle')
    const app = src('App.jsx')
    expect(app).toContain("['/', '/signin', '/signup', '/forgot-password'].includes(location.pathname)")
    expect(app).toContain('{!hasOwnToggle && <ThemeToggle')
  })

  it('uses one shared store: components never keep their own theme state', () => {
    for (const f of ['components/ThemeToggle.jsx', 'components/Nav.jsx', 'App.jsx']) expect(src(f)).not.toMatch(/useState\([^)]*(dark|theme)/i)
    expect(src('theme/useTheme.js')).toContain('useSyncExternalStore')
  })
})
