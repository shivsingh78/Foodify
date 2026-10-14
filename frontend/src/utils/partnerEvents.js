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
