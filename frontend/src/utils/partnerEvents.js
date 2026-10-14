/**
 * Delivery dashboard reactions to server events, kept free of React so they can be tested directly.
 * The server is the source of truth: events only trigger a refetch and a visible hint.
 */
export const makeReadyForPickupHandler = ({ refreshCurrentOrder, refreshAssignments, setAlert }) => (payload) => {
  setAlert(payload?.shopName ? `${payload.shopName} has marked your order out for delivery: it is ready for pickup.` : 'Your order is ready for pickup.')
  return Promise.all([refreshCurrentOrder(), refreshAssignments()])
}

/** After a socket reconnect, events may have been missed: reload offers, the active delivery and today's stats. */
export const makeResyncHandler = ({ refreshCurrentOrder, refreshAssignments, refreshToday }) => () =>
  Promise.all([refreshAssignments(), refreshCurrentOrder(), refreshToday()])

/**
 * Keeps the partner's position fresh on the server while the dashboard is open. The browser only reports a
 * position when it CHANGES, so a stationary partner would otherwise become ineligible for offers once the last
 * report is older than the server's freshness limit (DISPATCH_LOCATION_MAX_AGE_SECONDS, 120 s by default).
 * Re-sending the last known position is accurate: movement still arrives immediately through the watch.
 */
export const startLocationHeartbeat = ({ emit, intervalMs = 30_000, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) => {
  let last = null
  const timer = setIntervalFn(() => {
    if (last) emit(last)
  }, intervalMs)
  return {
    update: (position) => {
      last = position
      emit(position)
    },
    stop: () => clearIntervalFn(timer),
  }
}

/** Reloads the signed-in user's orders from the API (the source of truth) into the store. */
export const makeOrdersRefetch = ({ fetchOrders, setOrders }) => async () => {
  try {
    setOrders(await fetchOrders())
  } catch {
    // keep what is on screen; the next event or reload will retry
  }
}

/** Human-readable reason the browser could not provide a position (GeolocationPositionError codes 1-3). */
export const describeGeoError = (error) => {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'Location needs a secure (https) connection. You will not receive delivery offers.'
  switch (error?.code) {
    case 1: return 'Location permission is blocked. Allow location for this site to receive delivery offers.'
    case 2: return 'Your device could not determine its location. You will not receive delivery offers until it can.'
    case 3: return 'Getting your location timed out. Retrying; offers need a recent location.'
    default: return 'Location is unavailable. You will not receive delivery offers until it is shared.'
  }
}
