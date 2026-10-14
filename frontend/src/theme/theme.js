/**
 * Pure theme helpers (no React, no DOM access at import time) so they can be unit tested and shared.
 * The explicit user choice is stored under THEME_KEY; without one the operating-system preference decides.
 * public/theme-init.js applies the same rules before first paint to avoid a flash of the wrong theme.
 */
export const THEME_KEY = 'foodify-theme'
export const THEMES = ['light', 'dark']

export const isTheme = (value) => THEMES.includes(value)

/** The saved explicit choice, or null (never throws: storage can be blocked, e.g. private mode). */
export const readStoredTheme = (storage = safeStorage()) => {
  try {
    const value = storage?.getItem(THEME_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

export const writeStoredTheme = (theme, storage = safeStorage()) => {
  try {
    if (isTheme(theme)) storage?.setItem(THEME_KEY, theme)
    else storage?.removeItem(THEME_KEY)
    return true
  } catch {
    return false
  }
}

export const systemPrefersDark = (matchMedia = typeof window === 'undefined' ? undefined : window.matchMedia) => {
  try {
    return Boolean(matchMedia?.call(typeof window === 'undefined' ? undefined : window, '(prefers-color-scheme: dark)').matches)
  } catch {
    return false
  }
}

/** Saved choice wins; otherwise follow the system. */
export const resolveTheme = (stored, prefersDark) => (isTheme(stored) ? stored : prefersDark ? 'dark' : 'light')

export const THEME_COLORS = { light: '#faf7f2', dark: '#14110f' }

/** Applies a theme to the document: attribute (drives the CSS tokens), native colour-scheme and the browser UI colour. */
export const applyTheme = (theme, doc = typeof document === 'undefined' ? undefined : document) => {
  if (!doc || !isTheme(theme)) return
  const root = doc.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
}

function safeStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}
