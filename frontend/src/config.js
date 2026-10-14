import { readPublicConfig, resolveServerUrl } from './runtimeConfig'

// Empty (unset) means same-origin: the backend serves the SPA and the API together.
export const serverUrl = resolveServerUrl(readPublicConfig())
