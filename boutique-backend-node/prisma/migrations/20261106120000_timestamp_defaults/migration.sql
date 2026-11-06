-- Records created by the Node backend were saved with NULL created_at/updated_at,
-- because only order_status_histories had a default. This adds database defaults
-- (Prisma also sets updated_at on every write via @updatedAt), then backfills
-- the rows that were saved without dates.

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "password_reset_tokens" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "product_images" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "categories" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "wishlists" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "videos" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "offers" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "store_settings" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "contact_messages" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "addresses" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Backfill: orders take the time of their first status-history entry ("Order placed"),
-- which always had a timestamp; order items follow their order.
UPDATE "orders" o
SET "created_at" = h.first_at
FROM (
  SELECT "order_id", MIN("created_at") AS first_at
  FROM "order_status_histories"
  GROUP BY "order_id"
) h
WHERE o."created_at" IS NULL AND h."order_id" = o."id";

UPDATE "order_items" i
SET "created_at" = o."created_at"
FROM "orders" o
WHERE i."created_at" IS NULL AND i."order_id" = o."id" AND o."created_at" IS NOT NULL;

-- Any remaining rows have no better source; use the migration time.
UPDATE "users" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "products" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "product_images" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "categories" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "wishlists" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "videos" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "offers" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "store_settings" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "contact_messages" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "addresses" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "orders" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "order_items" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;

-- updated_at starts equal to created_at where it was never set.
UPDATE "users" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "products" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "product_images" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "categories" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "wishlists" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "videos" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "offers" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "store_settings" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "contact_messages" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "addresses" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "orders" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "order_items" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;

-- Orders placed without an expected delivery date get the standard 6-day estimate.
UPDATE "orders"
SET "expected_delivery_date" = ("created_at" + INTERVAL '6 days')::date
WHERE "expected_delivery_date" IS NULL AND "status" <> 'Cancelled';
