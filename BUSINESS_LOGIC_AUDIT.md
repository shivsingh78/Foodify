# Foodify — Backend Business Logic Audit

This audit is based on the uploaded Foodify backend source.

## Critical issues — fix before new features

### 1. Signup trusts the client-provided role

Current behavior:

```text
POST /api/auth/signup
body.role → directly stored
```

A client can potentially submit:

```json
{
  "role": "owner"
}
```

or:

```json
{
  "role": "deliveryBoy"
}
```

This is a privilege-escalation risk.

### Correct direction

Normal public signup should create only:

```text
role = "user"
```

Owner/delivery accounts should be created through a controlled workflow.

---

### 2. Google authentication trusts role and profile data

The Google auth endpoint accepts `role` and `mobile` from the request body.

The backend should verify identity using the Google identity token and should not allow the client to choose a privileged application role.

---

### 3. Item edit/delete has no ownership check

The current routes use:

```text
isAuth → editItem/deleteItem
```

but the controller does not verify that:

```text
item.shop.owner === req.userId
```

Therefore an authenticated user may potentially modify another owner's item if they know the item ID.

### Correct rule

```text
Authenticated
+
Owner role
+
Item belongs to user's shop
        ↓
allowed
```

---

### 4. Order status update has no authorization check

`updateOrderStatus` finds the order and shop order but does not verify that the authenticated user owns that shop/order.

The backend should verify:

```text
req.userId
    ↓
shop.owner
    ↓
shopOrder.shop
```

before changing the status.

Later this becomes a role-aware state transition policy.

---

### 5. Order ID endpoint has no ownership/role authorization

`getOrderById` only verifies that the order exists.

It should verify that the requester is allowed to view it:

```text
customer → own order
owner → order containing own shopOrder
deliveryBoy → assigned shopOrder
admin → any authorized order
```

Do not rely on obscurity of MongoDB ObjectIds.

---

### 6. Delivery assignment acceptance has a race condition

Current flow:

```text
check assignment status
        ↓
check delivery boy availability
        ↓
set assignedTo
        ↓
save
```

Two delivery boys can race on the same assignment.

The final design should make assignment acceptance atomic or otherwise enforce a single winner.

Also verify that:

```text
req.userId ∈ brodcastedTo
```

before accepting.

---

### 7. Delivery OTP endpoints need authorization

`sendDeliveryOtp` and `verifyDeliveryOtp` accept `orderId` and `shopOrderId`, but the controller does not sufficiently verify that the current user is the assigned delivery actor/customer/authorized role for that operation.

The backend must define:

```text
who can send OTP?
who can verify OTP?
when can OTP be generated?
when can OTP be verified?
```

---

### 8. Client controls order price

`placeOrder` uses:

```text
item.price
totalAmount
```

from the request.

This is a serious business-integrity problem.

The client should send only:

```text
product/item ID
quantity
size/options
```

The backend should load current prices from the database and calculate:

```text
item subtotal
shop subtotal
order total
```

Server-side.

---

### 9. Client can potentially influence payment amount

Razorpay order creation currently derives the amount from the client-supplied `totalAmount`.

The amount must be calculated from trusted server-side order data.

The payment gateway amount must match the server-generated order total.

---

### 10. Order status is arbitrary from the client

The status field is directly assigned from:

```text
req.body.status
```

The backend should use a state-transition map.

Example:

```text
PLACED
  ↓
ACCEPTED
  ↓
PREPARING
  ↓
READY
  ↓
OUT_FOR_DELIVERY
  ↓
DELIVERED
```

The backend must reject invalid jumps.

---

## High-priority correctness issues

### 11. `getCurrentUser` returns the full user document

The response currently includes the stored password hash unless explicitly omitted.

Never return password hashes to the client.

Use a safe select/projection.

---

### 12. Socket identity trusts a client-supplied user ID

The socket events accept:

```text
identity({ userId })
updateLocation({ ..., userId })
```

The server should derive the authenticated user from the socket's authentication/session instead of trusting a user ID sent by the browser.

Otherwise a malicious client may attempt to associate another account with its socket.

---

### 13. Socket location is broadcast globally

`updateLocation` currently emits delivery location to all connected sockets.

Location should only be sent to authorized participants who need the information.

Example:

```text
customer with active order
owner of relevant shop
assigned delivery participants
```

---

### 14. Multiple socket connections can cause stale online state

If a user opens multiple tabs/devices:

```text
socket A connected
socket B connected
socket A disconnects
```

the disconnect handler can mark the user offline even though socket B is still active.

Track active connections or verify that the disconnecting socket is the currently registered connection.

---

### 15. `updateOrderStatus` can crash on invalid order ID

The code accesses:

```text
order.shopOrders
```

before checking that `order` exists.

Validate `order` first.

---

### 16. Coordinate validation is weak

Location updates accept `lat/lon` without validation.

Validate:

```text
latitude  ∈ [-90, 90]
longitude ∈ [-180, 180]
```

Also avoid truthy checks for coordinates because `0` is a valid coordinate.

---

### 17. Rating logic needs a real business rule

Current rating logic allows repeated ratings without identifying the reviewer.

This can inflate:

```text
rating.count
rating.average
```

Recommended future model:

```text
Review
├── user
├── item
├── rating
├── comment
└── createdAt
```

Then enforce:

```text
one review per user per purchased item/order
```

and calculate/update aggregates safely.

---

### 18. Item deletion may not correctly remove the reference

The shop item array uses MongoDB ObjectIds.

Comparing ObjectId objects with JavaScript reference inequality is unsafe.

Use:

```text
equals()
```

or compare string values.

Better still, make the database operation atomic.

---

### 19. Item ownership is missing during edit

Even when the item exists, the edit operation does not first verify the item belongs to the authenticated owner's shop.

---

### 20. Shop creation should enforce one-shop/business ownership rule

`createEditShop` assumes one shop per owner but the business rule should be explicit.

Add a unique constraint/index strategy appropriate to that rule.

---

## Architecture problems to solve during TypeScript migration

### Controllers contain too much business logic

The order controller is currently very large.

Especially:

```text
placeOrder
updateOrderStatus
acceptOrder
delivery OTP logic
```

These should move toward:

```text
controller
   ↓
service/domain
   ↓
repository/data access
```

---

# Target architecture

```text
src/
├── controllers/
├── services/
├── repositories/
├── routes/
├── middlewares/
├── validators/
├── schemas/
├── events/
├── lib/
├── utils/
├── types/
└── app.ts
```

## Responsibility

### Controller

```text
HTTP request
↓
parse/validate
↓
authorize
↓
call service
↓
HTTP response
```

### Service

```text
business rules
state transitions
calculations
orchestration
```

### Repository

```text
database access
Prisma
native MongoDB aggregation where required
```

### Validator

```text
Zod runtime validation
```

---

# First refactoring target

Do **not** start by rewriting the 700-line order controller.

Start with a small vertical slice:

```text
User signup
    ↓
TypeScript
    ↓
Zod
    ↓
Auth service
    ↓
Prisma
    ↓
MongoDB
```

Once the pattern is correct, use the same architecture for the remaining modules.

---

# Recommended migration order

```text
1. package/tooling
2. app.ts / server.ts
3. database layer
4. Prisma schema/client
5. shared types
6. auth middleware
7. Zod schemas
8. auth controller/service
9. user controller/service
10. shop controller/service
11. item controller/service
12. order controller/service
13. socket layer
14. tests
```

Do not run JavaScript and TypeScript versions of the same business logic indefinitely. Migrate one domain completely, verify it, then remove the old version.
