# Foodify Upgrade Plan

## 1. Goal

The purpose of this upgrade is not to keep adding random features.

The purpose is to make Foodify demonstrate stronger:

- backend engineering
- database design
- caching
- API protection
- real-time systems
- event-driven thinking
- analytics
- search
- personalization
- scalability

The implementation order below is deliberate.

---

# 2. Priority order

## Priority A — Infrastructure first

### A1. Redis
### A2. Caching
### A3. Rate limiting
### A4. Cache invalidation

Reason:

Redis becomes a reusable foundation for later improvements. It also gives the project a real performance/scalability story.

---

# 3. Redis implementation

## 3.1 Redis responsibilities

Keep Redis responsibilities clear.

```text
Redis
├── Response caching
├── Rate-limit counters
└── Temporary/short-lived data when needed
```

Do not immediately put every piece of application data into Redis.

MongoDB remains the primary source of truth.

---

## 3.2 Recommended key naming

Use predictable prefixes.

```text
foodify:restaurant:{id}
foodify:product:{id}
foodify:products:{queryHash}
foodify:restaurants:{queryHash}
foodify:ratelimit:login:{ip}
foodify:ratelimit:register:{ip}
```

Use TTLs so stale cache entries eventually disappear.

Example:

```text
restaurant detail → 5–15 minutes
product list      → 1–5 minutes
search results    → short TTL
rate-limit keys   → depends on the rate-limit window
```

The exact TTL should be measured and adjusted rather than blindly chosen.

---

# 4. Caching strategy

Use **cache-aside**.

```text
Client
  ↓
API
  ↓
Redis GET
  ├── HIT → return cached data
  │
  └── MISS
        ↓
      MongoDB
        ↓
      Redis SET
        ↓
      return response
```

## Cache the right data

Good candidates:

- restaurant details
- menu/product listings
- categories
- popular products
- frequently requested public data

Avoid caching highly dynamic user-specific data initially.

Examples that should normally remain database-driven:

- current cart
- payment state
- current order ownership
- security-sensitive account state

---

# 5. Cache invalidation

Caching without invalidation creates incorrect data.

For owner updates:

```text
Owner edits product
      ↓
MongoDB update
      ↓
Delete related Redis cache
      ↓
Next GET hits MongoDB
      ↓
Fresh data is cached
```

Do this for operations such as:

```text
create product
update product
delete product
update restaurant
change availability
```

---

# 6. Rate limiting

Implement rate limiting per endpoint group instead of one global number.

Suggested groups:

```text
Authentication
  ├── register
  ├── login
  ├── OTP verification
  └── password recovery

Sensitive actions
  ├── payment creation
  ├── order creation
  └── repeated verification attempts

General API
  └── normal browsing/search
```

## Example policy direction

These are starting points, not final numbers:

```text
Login       → strict
Register    → strict
OTP         → very strict
Payment     → strict
Order       → moderate
Search      → moderate
Public GET  → lenient
```

The final limits should be tested against normal user behavior.

---

# 7. Analytics with MongoDB aggregation

Once Redis/rate limiting is stable, build the analytics backend.

## 7.1 First metrics

Start with:

```text
Total orders
Total revenue
Today's orders
Today's revenue
Average order value
Cancelled orders
Top products
Orders by status
Revenue over time
```

---

## 7.2 Aggregation examples

### Revenue by day

Conceptual pipeline:

```javascript
[
  {
    $match: {
      status: "DELIVERED"
    }
  },
  {
    $group: {
      _id: {
        $dateToString: {
          format: "%Y-%m-%d",
          date: "$createdAt"
        }
      },
      revenue: {
        $sum: "$totalAmount"
      },
      orders: {
        $sum: 1
      }
    }
  },
  {
    $sort: {
      _id: 1
    }
  }
]
```

Adjust field names to match the actual Foodify order schema.

---

### Best-selling products

Conceptual pipeline:

```javascript
[
  { $unwind: "$items" },
  {
    $group: {
      _id: "$items.product",
      quantitySold: {
        $sum: "$items.quantity"
      }
    }
  },
  {
    $sort: {
      quantitySold: -1
    }
  },
  {
    $limit: 10
  }
]
```

Again, adapt this to the real schema.

---

# 8. Analytics API design

Prefer focused APIs instead of one giant analytics endpoint.

Example:

```text
GET /owner/analytics/overview
GET /owner/analytics/revenue
GET /owner/analytics/orders
GET /owner/analytics/top-products
GET /owner/analytics/order-status
```

Common query parameters:

```text
from
to
period
```

Example:

```text
GET /owner/analytics/revenue?from=2026-09-01&to=2026-09-13
```

---

# 9. Analytics dashboard

Dashboard sections:

```text
┌────────────────────────────────────────────────────┐
│ Total Revenue | Orders | Avg Order | Cancellations│
├────────────────────────────────────────────────────┤
│                Revenue Over Time                   │
├──────────────────────────┬─────────────────────────┤
│ Orders by Status          │ Top Selling Products   │
├──────────────────────────┴─────────────────────────┤
│              Recent Orders                         │
└────────────────────────────────────────────────────┘
```

Do not calculate revenue from raw orders inside React.

React should request analytics APIs and render the returned data.

---

# 10. Order lifecycle

After analytics, formalize order states.

Recommended initial states:

```text
PLACED
ACCEPTED
PREPARING
READY
OUT_FOR_DELIVERY
DELIVERED
CANCELLED
```

## Valid transitions

Example:

```text
PLACED → ACCEPTED
PLACED → CANCELLED

ACCEPTED → PREPARING
ACCEPTED → CANCELLED

PREPARING → READY
READY → OUT_FOR_DELIVERY
OUT_FOR_DELIVERY → DELIVERED
```

Do not let the client send any arbitrary status.

The backend must decide whether a transition is valid.

---

# 11. Order state machine

Create a single transition map in the backend.

Conceptual example:

```javascript
const transitions = {
  PLACED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY"],
  READY: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: []
};
```

Then validate:

```text
currentStatus
+
requestedStatus
↓
transition allowed?
```

This prevents invalid changes.

---

# 12. Real-time event system

Use Socket.io around meaningful domain events.

Example event names:

```text
order:created
order:accepted
order:preparing
order:ready
order:out_for_delivery
order:delivered
order:cancelled
```

Flow:

```text
Owner changes status
       ↓
Backend validates transition
       ↓
MongoDB updated
       ↓
Event emitted
       ↓
Socket.io room
       ↓
Customer / delivery / owner receives update
```

---

# 13. Socket rooms

Do not broadcast every order event to every connected user.

Use rooms.

Example:

```text
order:{orderId}
user:{userId}
restaurant:{restaurantId}
delivery:{deliveryBoyId}
```

Possible subscriptions:

```text
Customer → order:{orderId}
Owner    → restaurant:{restaurantId}
Delivery → delivery:{deliveryBoyId}
```

This becomes a good interview discussion around scalability and event fan-out.

---

# 14. Failure handling for real-time events

A real-time connection is not the source of truth.

MongoDB remains the source of truth.

Therefore:

```text
MongoDB update succeeds
        ↓
Socket emission fails
        ↓
Order is still correct in DB
```

On reconnect, the client should refetch current order state.

This avoids making the system dependent on a live socket connection.

---

# 15. Notifications

Create a notification model similar to:

```text
Notification
├── user
├── type
├── title
├── message
├── referenceId
├── isRead
└── createdAt
```

Example types:

```text
ORDER_CREATED
ORDER_ACCEPTED
ORDER_PREPARING
ORDER_READY
ORDER_OUT_FOR_DELIVERY
ORDER_DELIVERED
ORDER_CANCELLED
PAYMENT_FAILED
```

Flow:

```text
Order event
   ↓
Create notification
   ↓
Save notification
   ↓
Emit Socket.io notification
   ↓
Update notification badge
```

The database keeps the notification history even when the user is offline.

---

# 16. Search + filtering + pagination

Once the core order flow is stable, improve discovery.

## Search fields

Possible starting fields:

```text
product name
restaurant name
category
description
```

## Filters

```text
category
price range
rating
availability
restaurant
```

## Sorting

```text
price ascending
price descending
rating
newest
popularity
```

## Pagination

For the first implementation, standard page/limit pagination is acceptable.

```text
page=1
limit=12
```

Later, high-volume feeds can be evaluated for cursor pagination.

---

# 17. MongoDB indexing

Indexes should support actual query patterns.

Potential index candidates:

```text
products.name
products.category
products.restaurant
products.price
orders.user
orders.status
orders.createdAt
```

Do not create indexes blindly.

For each index, answer:

```text
Which query needs it?
How often is that query used?
What write cost does the index add?
```

Use `explain()` when evaluating expensive queries.

---

# 18. Recommendation system

Build a simple recommendation engine first.

## Signals

```text
Past orders
Viewed products
Favorite categories
Popular products
Recently purchased items
```

## Baseline algorithm

Example score:

```text
score =
  categoryMatch * 3
  + popularity * 2
  + recentView * 2
  + previousOrder * 3
```

This is enough to demonstrate recommendation logic without pretending to have a machine-learning model.

Later options:

```text
content-based recommendations
collaborative filtering
embedding-based recommendations
ML ranking
```

Only move to advanced ML after enough behavioral data exists.

---

# 19. API consistency

As features increase, standardize API responses.

Example success:

```json
{
  "success": true,
  "message": "Products fetched successfully",
  "data": {}
}
```

Example error:

```json
{
  "success": false,
  "message": "Invalid order status transition",
  "code": "INVALID_ORDER_TRANSITION"
}
```

Keep this consistent across controllers.

---

# 20. Error handling

Create centralized error handling for:

```text
validation errors
authentication errors
authorization errors
MongoDB errors
Redis errors
payment errors
socket/realtime errors
unexpected server errors
```

Do not leak internal stack traces to production clients.

---

# 21. Observability

Before finalizing the project, add structured logging around:

```text
request
response time
status code
user/action
order id
payment id
cache hit/miss
rate-limit rejection
errors
```

This can later support debugging and performance measurement.

---

# 22. Testing strategy

Minimum useful tests:

## Authentication

```text
register
login
invalid password
unauthorized request
```

## Orders

```text
create order
invalid order
valid transition
invalid transition
cancel order
```

## Redis

```text
cache miss
cache hit
cache invalidation
Redis unavailable
```

## Rate limiting

```text
within limit
limit exceeded
window resets
```

## Search

```text
search
filter
sort
pagination
```

## Analytics

```text
correct revenue
correct order count
correct top products
```

---

# 23. Docker / local development

A useful local setup is:

```text
Frontend
Backend
MongoDB
Redis
```

Eventually:

```text
docker compose up -d
```

The README should explain:

```text
environment variables
install commands
development commands
Docker commands
database setup
Redis setup
frontend URL
backend URL
```

Use `.env.example` and never commit secrets.

---

# 24. Suggested Git branch strategy

Use one branch per upgrade.

```text
main
│
├── feature/redis-cache
├── feature/rate-limiting
├── feature/analytics
├── feature/order-state-machine
├── feature/realtime-orders
├── feature/notifications
├── feature/search-pagination
└── feature/recommendations
```

Suggested implementation order:

```text
1. feature/redis-cache
2. feature/rate-limiting
3. feature/analytics
4. feature/order-state-machine
5. feature/realtime-orders
6. feature/notifications
7. feature/search-pagination
8. feature/recommendations
```

---

# 25. Definition of done

A feature should not be considered finished just because its UI works.

Each feature should have:

```text
Backend implementation
      ↓
Validation
      ↓
Error handling
      ↓
Database/index review
      ↓
Tests
      ↓
Frontend integration
      ↓
README/documentation
      ↓
Deployment check
```

---

# 26. Resume strategy

Do not list every feature in the resume.

Choose the strongest engineering points.

Recommended emphasis:

### Version 1 resume story

```text
JWT authentication
Razorpay
Cloudinary
role-based order management
real-time order tracking
```

### Version 2 resume story

Add:

```text
Redis caching
API rate limiting
MongoDB aggregation
analytics dashboard
order state machine
event-driven real-time updates
```

### Version 3 resume story

Add only if actually implemented:

```text
notifications
search/filter/pagination
recommendation system
Docker/CI/CD
measured performance improvements
```

---

# 27. Metrics to collect

This is very important for a strong resume.

Before vs after Redis:

```text
response time
database query count
cache hit ratio
```

For rate limiting:

```text
blocked requests
protected endpoints
rate-limit window
```

For analytics:

```text
aggregation execution time
indexed vs unindexed query performance
```

For real-time:

```text
order update latency
```

Do not invent these numbers.

Measure them.

---

# 28. Final implementation sequence

```text
┌──────────────────────────────────────────┐
│ PHASE 1                                  │
│ Redis + caching + rate limiting          │
└──────────────────────┬───────────────────┘
                       ↓
┌──────────────────────────────────────────┐
│ PHASE 2                                  │
│ Mongo aggregation + analytics dashboard  │
└──────────────────────┬───────────────────┘
                       ↓
┌──────────────────────────────────────────┐
│ PHASE 3                                  │
│ Order lifecycle + Socket.io events       │
└──────────────────────┬───────────────────┘
                       ↓
┌──────────────────────────────────────────┐
│ PHASE 4                                  │
│ Notifications                             │
└──────────────────────┬───────────────────┘
                       ↓
┌──────────────────────────────────────────┐
│ PHASE 5                                  │
│ Search + filtering + pagination           │
└──────────────────────┬───────────────────┘
                       ↓
┌──────────────────────────────────────────┐
│ PHASE 6                                  │
│ Recommendation system                    │
└──────────────────────┬───────────────────┘
                       ↓
┌──────────────────────────────────────────┐
│ PHASE 7                                  │
│ Tests + Docker + CI/CD + README          │
└──────────────────────────────────────────┘
```

---

# 29. First task to implement

Start with:

```text
Redis connection
      ↓
Redis utility/service
      ↓
cache middleware/helper
      ↓
cache one read-heavy endpoint
      ↓
measure hit/miss
      ↓
add invalidation
      ↓
add rate limiting
```

Do not cache the entire application on day one.

Start with one endpoint, verify the design, then expand.

---

# 30. Interview preparation checklist

After each phase, be able to explain:

```text
What problem did I solve?
Why did I choose this technology?
How does the request flow work?
What happens on failure?
How does it scale?
What tradeoff did I make?
What alternative could I use?
How did I measure the improvement?
```

That explanation is the real value of the upgrade.
