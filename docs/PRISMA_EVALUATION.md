# Prisma + MongoDB evaluation

**Decision: Prisma was not introduced. Mongoose stays the single data-access layer.**

## Findings

1. **Prisma 7 has no MongoDB connector.** Prisma's own Prisma 7 AMA states MongoDB is not supported yet, and MongoDB's Node driver docs advise staying on Prisma 6.x for MongoDB ([AMA](https://www.prisma.io/blog/prisma-7-ama-clearing-up-the-why-behind-the-changes), [MongoDB docs](https://www.mongodb.com/es/docs/drivers/node/v6.x/integrations/prisma/)). One Prisma docs page conflicts with this, so verify before relying on either. Adopting Prisma today would mean pinning the deprecated 6.x line.
2. **Features Foodify relies on are awkward or unsupported through Prisma's MongoDB connector:** `2dsphere` indexes and `$near` queries (delivery-partner matching), `$elemMatch` + positional (`shopOrders.$`) updates used for race-free order state transitions, update pipelines used for rating averages, and `$facet` analytics pipelines. These would need `$runCommandRaw`/`aggregateRaw`, losing the type safety that motivated Prisma.
3. **Data model:** `shopOrders` are embedded sub-documents with their own `_id`s (updating one element by its `_id` is not something I could confirm Prisma's composite types support), and several unique/partial indexes (`idempotencyKey`, one active assignment per partner) are partial indexes that Prisma's schema cannot express.
4. Prisma on MongoDB needs a replica set for transactions; local `mongod` standalone would not work.

## What provides type safety instead

Mongoose models are fully typed (`IUser`, `IOrder`, …), inputs are validated with shared Zod schemas, and the backend compiles under `strict` + `noUncheckedIndexedAccess`.

## Revisit when

Prisma ships a MongoDB connector for its current major version (or Prisma Next reaches GA for MongoDB) **and** it supports geospatial queries and positional/array-filter updates. Migration prerequisites then: a staging copy of the database, a Prisma schema generated with `db pull`, one low-risk domain first (notifications), keeping aggregation pipelines in raw form.
