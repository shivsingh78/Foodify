import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { applyTheme, isTheme, readStoredTheme, resolveTheme, systemPrefersDark, THEME_KEY, writeStoredTheme } from '../src/theme/theme.js'

const memoryStorage = (initial = {}) => {
  const data = { ...initial }
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)), removeItem: (k) => void delete data[k], data }
}

describe('theme resolution', () => {
  it('uses the saved explicit choice, otherwise the system preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
    expect(resolveTheme('sepia', true)).toBe('dark') // junk in storage is ignored
    expect(isTheme('dark') && isTheme('light') && !isTheme('auto')).toBe(true)
  })

  it('persists and restores only valid choices, and clears with null', () => {
    const storage = memoryStorage()
    expect(readStoredTheme(storage)).toBeNull()
    writeStoredTheme('dark', storage)
    expect(storage.data[THEME_KEY]).toBe('dark')
    expect(readStoredTheme(storage)).toBe('dark')
    writeStoredTheme(null, storage)
    expect(readStoredTheme(storage)).toBeNull()
    expect(readStoredTheme(memoryStorage({ [THEME_KEY]: 'neon' }))).toBeNull()
  })

  it('never throws when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
    expect(readStoredTheme(blocked)).toBeNull()
    expect(writeStoredTheme('dark', blocked)).toBe(false)
  })

  it('reads the system preference from matchMedia and tolerates its absence', () => {
    expect(systemPrefersDark(() => ({ matches: true }))).toBe(true)
    expect(systemPrefersDark(() => ({ matches: false }))).toBe(false)
    expect(systemPrefersDark(undefined)).toBe(false)
    expect(systemPrefersDark(() => { throw new Error('x') })).toBe(false)
  })

  it('applies the attribute, colour-scheme and browser theme colour', () => {
    const meta = { setAttribute: vi.fn() }
    const doc = { documentElement: { dataset: {}, style: {} }, querySelector: vi.fn(() => meta) }
    applyTheme('dark', doc)
    expect(doc.documentElement.dataset.theme).toBe('dark')
    expect(doc.documentElement.style.colorScheme).toBe('dark')
    expect(meta.setAttribute).toHaveBeenCalledWith('content', '#14110f')
    applyTheme('nope', doc)
    expect(doc.documentElement.dataset.theme).toBe('dark')
  })
})

describe('pre-paint script (public/theme-init.js)', () => {
  const run = ({ saved, dark, storageThrows = false }) => {
    const attrs = {}
    const window = {
      localStorage: { getItem: () => { if (storageThrows) throw new Error('denied'); return saved ?? null } },
      matchMedia: (q) => ({ matches: q.includes('dark') && dark }),
    }
    const document = { documentElement: { setAttribute: (k, v) => void (attrs[k] = v), style: {} } }
    vm.runInNewContext(readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8'), { window, document })
    return { attrs, scheme: document.documentElement.style.colorScheme }
  }

  it('applies the system preference on a first visit, and the saved choice afterwards (same rules as the app)', () => {
    expect(run({ dark: true }).attrs['data-theme']).toBe('dark')
    expect(run({ dark: false }).attrs['data-theme']).toBe('light')
    expect(run({ saved: 'light', dark: true }).attrs['data-theme']).toBe('light')
    expect(run({ saved: 'dark', dark: false })).toMatchObject({ attrs: { 'data-theme': 'dark' }, scheme: 'dark' })
    expect(run({ saved: 'garbage', dark: true }).attrs['data-theme']).toBe('dark')
    for (const saved of [undefined, 'light', 'dark', 'x']) for (const dark of [true, false]) {
      expect(run({ saved, dark }).attrs['data-theme']).toBe(resolveTheme(readStoredTheme(memoryStorage(saved ? { [THEME_KEY]: saved } : {})), dark))
    }
  })

  it('still works when storage throws', () => {
    expect(run({ dark: true, storageThrows: true }).attrs['data-theme']).toBe('dark')
    expect(run({ dark: false, storageThrows: true }).attrs['data-theme']).toBe('light')
  })

  it('is loaded synchronously in <head> before the app bundle', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toContain('<script src="/theme-init.js"></script>')
    expect(head).not.toMatch(/type="module"/)
  })
})

describe('design tokens', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const light = css.slice(css.indexOf('@theme'), css.indexOf('}', css.indexOf('@theme')))
  const dark = css.slice(css.indexOf('html[data-theme="dark"] {'), css.indexOf('}', css.indexOf('html[data-theme="dark"] {')))
  const names = (block) => [...block.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1])

  it('dark mode overrides every light colour token (nothing is left white-only)', () => {
    const missing = names(light).filter((n) => !names(dark).includes(n))
    expect(missing).toEqual([])
  })

  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const value = (block, name) => new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)[1]

  it('text colours meet WCAG AA (4.5:1) in both themes', () => {
    for (const [block, label] of [[light, 'light'], [dark, 'dark']]) {
      for (const [fg, bg] of [['ink', 'background'], ['ink', 'surface'], ['muted', 'background'], ['muted', 'surface'], ['brand', 'surface'], ['brand', 'primary-soft'], ['success', 'success-soft'], ['warning', 'warning-soft'], ['danger', 'danger-soft'], ['info', 'info-soft']]) {
        expect(contrast(value(block, fg), value(block, bg)), `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrast('#ffffff', value(dark, 'primary')), 'white on primary buttons (dark)').toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ffffff', value(light, 'primary')), 'white on primary buttons (light)').toBeGreaterThanOrEqual(4.5)
  })

  it('respects reduced motion and does not fake dark mode with filters', () => {
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).not.toMatch(/filter:\s*invert/)
  })
})

describe('no hard-coded light-only colours remain in components', () => {
  it('uses theme tokens instead of bg-white / text-primary / raw palette reds', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
    const files = walk(new URL('../src', import.meta.url).pathname).filter((f) => f.endsWith('.jsx'))
    const offenders = files.flatMap((f) => {
      const text = readFileSync(f, 'utf8')
      return [/\bbg-white\b/, /\btext-primary(?![-\w])/, /\b(?:bg|text|border)-(?:red|gray|orange)-\d{2,3}\b/].filter((re) => re.test(text)).map((re) => `${f.split('/src/')[1]}: ${re}`)
    })
    expect(offenders).toEqual([])
  })
})
