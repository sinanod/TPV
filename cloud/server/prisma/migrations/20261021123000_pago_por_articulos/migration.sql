-- AlterTable
ALTER TABLE "OnlinePayment" ADD COLUMN     "items" JSONB;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "localId" INTEGER,
ADD COLUMN     "paidQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderPayment" ADD COLUMN     "items" JSONB;

