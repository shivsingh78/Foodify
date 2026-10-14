// Empty (unset) means same-origin: the backend serves the SPA and the API together.
export const serverUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')