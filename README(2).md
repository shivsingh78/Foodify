# Foodify

Foodify is a full-stack food ordering platform built to demonstrate real-world backend engineering, authentication, payments, media uploads, order management, real-time communication, caching, analytics, and scalable API design.

> **Project goal:** evolve Foodify from a normal MERN food-delivery clone into a production-oriented portfolio project that demonstrates practical system-design and backend engineering skills.

## Current project

The repository is organized into separate frontend and backend applications:

```text
Foodify/
├── frontend/
├── backend/
├── .env.example
├── .vscode/
└── README.md
```

The current application already includes core food-ordering functionality such as authentication, cart/order flows, Cloudinary-based image uploads, Razorpay integration, owner-side functionality, delivery assignment, OTP-related verification, and live order tracking.

## Planned production upgrade

The next version will focus on **depth over feature count**.

### Upgrade priorities

| Priority | Upgrade | Why it matters |
|---|---|---|
| 1 | Redis caching | Reduce repeated database reads and improve response time |
| 1 | API rate limiting | Protect authentication and sensitive APIs from abuse |
| 2 | MongoDB aggregation + analytics dashboard | Demonstrate reporting, aggregation, indexing, and business analytics |
| 3 | Order lifecycle + real-time event system | Make order processing production-like and event-driven |
| 4 | Notifications | Give users real-time order and account updates |
| 5 | Search + filtering + pagination | Improve usability and API scalability |
| 6 | Recommendation system | Add personalized food discovery using behavioral data |

See the detailed implementation plan in [`docs/FOODIFY_UPGRADE_PLAN.md`](docs/FOODIFY_UPGRADE_PLAN.md).

---

# Core functionality

## Customer

- User registration and login
- Authentication and authorization
- Browse food/products
- Product details
- Cart management
- Quantity and size selection
- Checkout and order creation
- Razorpay payment integration
- Order tracking
- Delivery/order verification flow

## Restaurant / Owner

- Product management
- Image upload through Cloudinary
- Order management
- Delivery-boy assignment
- Order verification / OTP flow
- Owner-side operations

## Delivery

- Assigned orders
- Order status updates
- Delivery verification

## Backend engineering

- Node.js + Express
- MongoDB + Mongoose
- JWT-based authentication
- Password hashing
- Cloudinary
- Razorpay
- Socket.io / real-time communication
- Role-based authorization

---

# Architecture direction

Foodify is intentionally being evolved toward the following architecture:

```text
                        ┌──────────────────┐
                        │     Frontend     │
                        │ React / Vite     │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  Express API     │
                        │ Auth / Business  │
                        └────────┬─────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
       ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
       │   Redis     │    │  MongoDB    │    │ Cloudinary  │
       │ Cache/Rate  │    │ Data/Stats  │    │   Images    │
       │   Limiting  │    │ Aggregation  │    │             │
       └─────────────┘    └─────────────┘    └─────────────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │ Event / Realtime │
                       │ Socket.io        │
                       └────────┬─────────┘
                                │
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
             Customer       Restaurant     Delivery
              updates         updates       updates
```

---

# Technology stack

### Frontend

- React
- Vite
- Tailwind CSS
- JavaScript / TypeScript where applicable

### Backend

- Node.js
- Express
- MongoDB
- Mongoose
- JWT
- bcrypt
- Socket.io

### Infrastructure / services

- Redis
- Cloudinary
- Razorpay
- Docker
- Cloud deployment


### Type safety and data access

The backend will be migrated to **TypeScript** and the API boundary will use **Zod** for runtime validation.

```text
HTTP Request
     ↓
Zod validation
     ↓
Typed controller
     ↓
Business/domain logic
     ↓
Prisma Client
     ↓
MongoDB
```

Prisma will provide a typed database client for MongoDB. For complex analytics, Foodify will use MongoDB's native aggregation capability where Prisma does not expose the aggregation pipeline directly. citeturn765643search0turn765643search1

The goal is not to use TypeScript just for `.ts` file extensions. The goal is to make incorrect states harder to express and easier to catch during development.

---

# Planned engineering improvements

## 1. Redis caching + rate limiting

The first upgrade is intentionally infrastructure-focused.

### Cache targets

Start with read-heavy endpoints such as:

```text
GET /restaurants
GET /restaurants/:id
GET /products
GET /products/:id
GET /categories
```

Use a cache-aside approach:

```text
Request
   ↓
Check Redis
   ↓
Cache hit ─────────────► Return cached response
   │
   └─ Cache miss
        ↓
      MongoDB
        ↓
   Store in Redis
        ↓
      Response
```

Cache invalidation will be added when an owner updates products or restaurant data.

### Rate limiting targets

Prioritize:

```text
POST /auth/login
POST /auth/register
POST /auth/forgot-password
POST /auth/verify-otp
POST /orders
POST /payments/*
```

The goal is to protect expensive or sensitive endpoints without making normal browsing painful.

---

# 2. MongoDB aggregation + analytics dashboard

Create owner-side analytics using MongoDB aggregation pipelines.

Example metrics:

- Total orders
- Total revenue
- Today's revenue
- Weekly revenue
- Monthly revenue
- Average order value
- Top-selling products
- Orders by status
- Cancelled orders
- Revenue by date

Example pipeline direction:

```text
orders
  ↓
$match
  ↓
$unwind items
  ↓
$group
  ↓
$sort
  ↓
$limit
  ↓
analytics result
```

The dashboard should be backed by API endpoints rather than calculating business metrics entirely on the frontend.

---

# 3. Order lifecycle + real-time event system

Move from a simple order status to a controlled lifecycle:

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

Possible failure/cancellation paths:

```text
PLACED ─────────────► CANCELLED
ACCEPTED ────────────► CANCELLED
OUT_FOR_DELIVERY ────► FAILED
```

Every transition should be validated on the backend.

Real-time updates:

```text
Order status changes
       ↓
Backend event
       ↓
Socket.io
       ↓
Customer UI / Owner UI / Delivery UI
```

This will give Foodify a much stronger system-design story than a refresh-based order page.

---

# 4. Notifications

Notifications should be connected to meaningful events rather than being added as isolated UI.

Examples:

```text
Order placed
Order accepted
Food is preparing
Food is ready
Delivery started
Order delivered
Payment failed
Order cancelled
```

Initial implementation can use in-app notifications and real-time delivery through Socket.io.

A notification record should contain enough information to support:

- unread/read state
- notification type
- related entity ID
- timestamp
- recipient
- message/title

---

# 5. Search + filtering + pagination

Add scalable query support for food/restaurant discovery.

Example:

```text
GET /products?
  search=pizza
  &category=fast-food
  &minPrice=100
  &maxPrice=500
  &sort=price_asc
  &page=1
  &limit=12
```

Important backend concepts:

- Query parsing
- Validation
- MongoDB indexes
- Sorting
- Pagination metadata
- Consistent response shape

Response metadata should include:

```json
{
  "page": 1,
  "limit": 12,
  "total": 48,
  "totalPages": 4,
  "hasNextPage": true
}
```

---

# 6. Recommendation system

Add recommendations only after the core system is stable.

Start simple instead of trying to build machine learning immediately.

Possible first version:

```text
User order history
       +
Recently viewed items
       +
Popular items
       +
Category preference
       ↓
Recommendation score
       ↓
Recommended food
```

Example:

```text
User frequently orders:
  Pizza
  Burger
  Pasta

Recommend:
  Garlic Bread
  Cheese Burst Pizza
  Pasta Combo
```

Later, the project can be upgraded to a more advanced recommendation approach if the collected data justifies it.

---

# Quality goals

The final Foodify version should demonstrate:

- Secure authentication
- Role-based authorization
- Input validation
- Centralized error handling
- Redis caching
- API rate limiting
- MongoDB indexes
- Aggregation pipelines
- Real-time communication
- Event-driven order updates
- Search and pagination
- Observability-friendly logging
- Dockerized services
- CI/CD
- Production-oriented API design

---

# Resume positioning

After the upgrades are actually implemented and measured, Foodify can be presented as a production-oriented full-stack project rather than only a food-delivery clone.

Example resume direction:

> **Foodify — Full-Stack Food Ordering Platform**  
> Built a MERN-based food ordering platform with JWT authentication, Razorpay payments, Cloudinary media storage, role-based order management, real-time order tracking, Redis caching/rate limiting, MongoDB aggregation analytics, and event-driven order lifecycle updates.

Only include features that are actually implemented and tested before putting them on the resume.

---

# Development roadmap

```text
Phase 1  → Redis setup
Phase 2  → Redis caching
Phase 3  → Rate limiting
Phase 4  → Cache invalidation
Phase 5  → MongoDB aggregation
Phase 6  → Owner analytics dashboard
Phase 7  → Order state machine
Phase 8  → Socket.io event system
Phase 9  → Notifications
Phase 10 → Search/filter/pagination
Phase 11 → Recommendation engine
Phase 12 → Tests + Docker + CI/CD + documentation
```

---

# Success criteria

The upgrade is complete when Foodify can answer these engineering questions clearly:

1. Why is this endpoint cached?
2. When does the cache become stale?
3. How is the cache invalidated?
4. Which APIs are rate-limited and why?
5. Which MongoDB indexes support search and analytics?
6. How is an order transition validated?
7. How are real-time events delivered?
8. What happens if Socket.io is unavailable?
9. How are notifications stored and marked read?
10. How does pagination behave with large datasets?
11. How are recommendations generated?
12. What happens when Redis or MongoDB is temporarily unavailable?

These are the kinds of questions that make this project useful in interviews.

---

## Documentation

Detailed implementation order, architecture decisions, API ideas, Redis strategy, aggregation pipeline ideas, testing checklist, and resume guidance:

**[`docs/FOODIFY_UPGRADE_PLAN.md`](docs/FOODIFY_UPGRADE_PLAN.md)**
