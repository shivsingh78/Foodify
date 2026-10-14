// Runs synchronously in <head> before first paint (an external file, so it works under a strict CSP).
// Keep the rules in sync with src/theme/theme.js: saved explicit choice, else the system preference.
(function () {
  var prefersDark = false
  try {
    prefersDark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  } catch {
    prefersDark = false
  }
  var theme = prefersDark ? 'dark' : 'light'
  try {
    // Storage can throw (blocked cookies, private mode); then the system preference stands.
    var saved = window.localStorage.getItem('foodify-theme')
    if (saved === 'light' || saved === 'dark') theme = saved
  } catch {
    theme = prefersDark ? 'dark' : 'light'
  }
  var root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
})()
