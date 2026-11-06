/*
  Warnings:

  - Made the column `created_at` on table `order_status_histories` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `order_status_histories` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "order_status_histories" ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updated_at" SET NOT NULL;
