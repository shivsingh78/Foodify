# Foodify Implementation Checklist

## Phase 0 — TypeScript + business logic audit
- [ ] Decide migration order for backend modules
- [ ] Add tsconfig
- [ ] Convert app/server entry point
- [ ] Convert routes
- [ ] Convert middleware
- [ ] Convert models/data access
- [ ] Convert controllers
- [ ] Convert services
- [ ] Add shared domain types
- [ ] Add Zod schemas
- [ ] Add centralized error types
- [ ] Remove `any` where avoidable
- [ ] Enable strict TypeScript settings
- [ ] Audit authentication on every protected route
- [ ] Audit authorization/ownership on every resource route
- [ ] Audit every controller for business-rule enforcement
- [ ] Audit price calculation on the server
- [ ] Audit duplicate request/idempotency risks
- [ ] Audit payment failure paths
- [ ] Audit Cloudinary failure paths
- [ ] Audit MongoDB failure paths
- [ ] Add controller/service tests for critical business rules

## Phase 0.5 — Prisma + MongoDB data layer
- [ ] Create Prisma schema for MongoDB
- [ ] Verify existing collections/documents against Prisma schema
- [ ] Map MongoDB ObjectId fields correctly
- [ ] Define model relations carefully
- [ ] Generate Prisma Client
- [ ] Introduce Prisma behind repository/service layer
- [ ] Keep aggregation-specific MongoDB access behind repository boundary
- [ ] Verify indexes and query patterns
- [ ] Test existing data before removing old Mongoose access
- [ ] Migrate one domain at a time

## Phase 1 — Redis
- [ ] Add Redis package/client
- [ ] Add Redis connection module
- [ ] Add connection/error logging
- [ ] Cache one read-heavy endpoint
- [ ] Add TTL
- [ ] Add cache invalidation
- [ ] Measure hit/miss behavior

## Phase 2 — Rate limiting
- [ ] Login limiter
- [ ] Register limiter
- [ ] OTP limiter
- [ ] Payment/order limiter
- [ ] General API limiter
- [ ] Return consistent 429 response

## Phase 3 — Analytics
- [ ] Verify order schema
- [ ] Add required MongoDB indexes
- [ ] Revenue aggregation
- [ ] Orders aggregation
- [ ] Top products aggregation
- [ ] Status aggregation
- [ ] Analytics controller/routes
- [ ] Owner dashboard

## Phase 4 — Order lifecycle
- [ ] Define statuses
- [ ] Define valid transitions
- [ ] Add transition validator
- [ ] Store status timestamps
- [ ] Prevent invalid transitions
- [ ] Handle cancellation/failure

## Phase 5 — Real-time events
- [ ] Socket.io rooms
- [ ] Order events
- [ ] Owner updates
- [ ] Customer updates
- [ ] Delivery updates
- [ ] Reconnect/refetch behavior

## Phase 6 — Notifications
- [ ] Notification model
- [ ] Notification types
- [ ] Create notification on order events
- [ ] Socket delivery
- [ ] Mark as read
- [ ] Notification list

## Phase 7 — Search
- [ ] Search
- [ ] Category filter
- [ ] Price filter
- [ ] Sort
- [ ] Pagination
- [ ] Pagination metadata
- [ ] Search indexes

## Phase 8 — Recommendations
- [ ] Store behavioral signals
- [ ] Define scoring
- [ ] Popular-items fallback
- [ ] Personalized recommendations
- [ ] Recommendation endpoint
- [ ] Measure recommendation quality

## Final polish
- [ ] Centralized error handling
- [ ] Input validation
- [ ] API response consistency
- [ ] Tests
- [ ] Docker
- [ ] CI/CD
- [ ] README
- [ ] Architecture diagram
- [ ] Measure performance
- [ ] Update resume
