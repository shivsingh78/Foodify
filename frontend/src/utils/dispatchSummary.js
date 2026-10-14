/**
 * Text for the restaurant's order card while no delivery partner is assigned. Built only from counts and state
 * (see GET /api/order/dispatch-summary): no partner names or phone numbers are ever shown here.
 */
export const describeDispatchSummary = (s) => {
  if (!s) return 'Checking for delivery partners…'
  const n = s.availablePartners ?? 0
  const available = n === 1 ? '1 delivery partner available nearby' : `${n} delivery partners available nearby`
  if (s.offerPending) {
    const left = s.offerExpiresInSeconds != null ? ` (${s.offerExpiresInSeconds}s left)` : ''
    return `${available}. Offer sent to a partner, waiting for them to accept${left}.`
  }
  if (s.searchStopped) return `${available}. The search stopped; use "Find a delivery partner again".`
  if (n === 0) return 'No delivery partner available nearby right now. Still looking…'
  return `${available}. Sending an offer…`
}
