import { useCallback, useSyncExternalStore } from 'react'
import { applyTheme, readStoredTheme, resolveTheme, systemPrefersDark, THEME_KEY, writeStoredTheme } from './theme'

/**
 * One module-level store, so every component (and every route) sees the same theme: no per-component state.
 * `preference` is the saved explicit choice (null = follow the system); `theme` is what is actually applied.
 */
let preference = null
let theme = 'light'
let started = false
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

const compute = () => {
  theme = resolveTheme(preference, systemPrefersDark())
  applyTheme(theme)
}

const start = () => {
  if (started || typeof window === 'undefined') return
  started = true
  preference = readStoredTheme()
  compute()
  // Without an explicit choice, follow live changes of the operating-system preference.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (preference === null) {
      compute()
      emit()
    }
  })
  // Keep several open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY || e.key === null) {
      preference = readStoredTheme()
      compute()
      emit()
    }
  })
}

const subscribe = (listener) => {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const getSnapshot = () => {
  start()
  return theme
}

/** Briefly enables colour transitions so a switch fades instead of snapping (skipped for reduced motion). */
const withTransition = (fn) => {
  const root = document.documentElement
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!reduce) {
    root.classList.add('theme-transition')
    window.setTimeout(() => root.classList.remove('theme-transition'), 250)
  }
  fn()
}

export const setThemePreference = (next) => {
  start()
  preference = next === 'light' || next === 'dark' ? next : null
  writeStoredTheme(preference)
  withTransition(() => {
    compute()
    emit()
  })
}

export function useTheme() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => 'light')
  const setTheme = useCallback((next) => setThemePreference(next), [])
  const toggle = useCallback(() => setThemePreference(theme === 'dark' ? 'light' : 'dark'), [])
  return { theme: current, isDark: current === 'dark', setTheme, toggle }
}

/** Test helper: forget module state. */
export const __resetThemeStoreForTests = () => {
  preference = null
  theme = 'light'
  started = false
  listeners.clear()
}
