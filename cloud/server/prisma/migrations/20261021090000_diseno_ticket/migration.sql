-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "ticketHeaderText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ticketLogo" BYTEA,
ADD COLUMN     "ticketLogoHash" TEXT,
ADD COLUMN     "ticketLogoHeight" INTEGER,
ADD COLUMN     "ticketLogoSize" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "ticketLogoStyle" TEXT NOT NULL DEFAULT 'THRESHOLD',
ADD COLUMN     "ticketLogoWidth" INTEGER,
ADD COLUMN     "ticketShowTable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ticketShowTradeName" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ticketShowWaiter" BOOLEAN NOT NULL DEFAULT true;

