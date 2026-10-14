export const getErrorMessage = (error, fallback = "Something went wrong. Please try again.") =>
  error?.response?.data?.message || error?.message || fallback;

/**
 * Firebase Auth error codes that point at project/domain configuration rather than the user.
 * `invalid-continue-uri` means the URL sent to Firebase is malformed/empty (a code bug);
 * `unauthorized-continue-uri` / `unauthorized-domain` mean the host is missing from
 * Firebase Console > Authentication > Settings > Authorized domains.
 */
export const FIREBASE_CONFIG_ERRORS = {
  'auth/invalid-continue-uri':
    'Sign-in could not continue because the redirect URL sent to Firebase is invalid. Please report this.',
  'auth/unauthorized-continue-uri': (origin) =>
    `${origin} is not an authorized domain for this Firebase project. Add it under Authentication > Settings > Authorized domains.`,
  'auth/unauthorized-domain': (origin) =>
    `${origin} is not an authorized domain for this Firebase project. Add it under Authentication > Settings > Authorized domains.`,
}

/** Firebase popup errors that need a friendlier message. */
export const getGoogleErrorMessage = (error, origin = globalThis.location?.origin ?? 'This site') => {
  const config = FIREBASE_CONFIG_ERRORS[error?.code]
  if (config) return typeof config === 'function' ? config(origin) : config
  if (error?.response?.data?.message) return error.response.data.message
  if (error?.code === 'auth/popup-blocked') {
    return 'Your browser blocked the Google window. Allow popups for this site and try again.'
  }
  if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') return ''
  return getErrorMessage(error)
}

export const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
