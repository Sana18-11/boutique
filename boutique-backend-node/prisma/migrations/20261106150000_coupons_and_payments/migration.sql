-- Coupon codes on offers, and price breakdown + Razorpay ids on orders.
-- All new columns are nullable, so existing rows are unaffected.

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "code" VARCHAR(50),
ADD COLUMN     "discount_type" VARCHAR(20),
ADD COLUMN     "discount_value" DECIMAL(10,2),
ADD COLUMN     "min_order_amount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "coupon_code" VARCHAR(50),
ADD COLUMN     "discount_amount" DECIMAL(10,2),
ADD COLUMN     "razorpay_order_id" VARCHAR(64),
ADD COLUMN     "razorpay_payment_id" VARCHAR(64),
ADD COLUMN     "shipping_amount" DECIMAL(10,2),
ADD COLUMN     "subtotal_amount" DECIMAL(10,2);

-- CreateIndex
CREATE UNIQUE INDEX "offers_code_key" ON "offers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_razorpay_order_id_key" ON "orders"("razorpay_order_id");
