-- AlterTable
ALTER TABLE "Category" DROP COLUMN "printerTag",
ADD COLUMN     "printerId" TEXT;

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "seriesNumber" INTEGER,
ADD COLUMN     "systemPrinters" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Dispositivos ya vinculados: serie T1, T2... por orden de alta en cada restaurante
UPDATE "Device" d SET "seriesNumber" = n.rn
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", id) AS rn FROM "Device") n
WHERE d.id = n.id;
ALTER TABLE "Device" ALTER COLUMN "seriesNumber" SET NOT NULL;

-- AlterTable
ALTER TABLE "DiningTable" ADD COLUMN     "qrToken" TEXT;
-- Mesas existentes: token aleatorio para su QR de pago
UPDATE "DiningTable" SET "qrToken" = gen_random_uuid()::text;
ALTER TABLE "DiningTable" ALTER COLUMN "qrToken" SET NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "invoiceNumber" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "TenantSettings" (
    "tenantId" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL DEFAULT '',
    "legalName" TEXT NOT NULL DEFAULT '',
    "nif" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "ticketFooter" TEXT NOT NULL DEFAULT '¡Gracias por su visita!',
    "receiptPrinterId" TEXT,
    "verifactuEnabled" BOOLEAN NOT NULL DEFAULT false,
    "verifactuEnvironment" TEXT NOT NULL DEFAULT 'TEST',
    "verifactuEndDate" DATE,
    "verifactuFirstSentAt" TIMESTAMP(3),
    "certificateKind" TEXT NOT NULL DEFAULT 'PERSONAL',
    "certificatePfx" BYTEA,
    "certificatePassword" BYTEA,
    "certificateSubject" TEXT,
    "certificateNotAfter" TIMESTAMP(3),
    "aeatNextSendAt" TIMESTAMP(3),
    "aeatLastError" TEXT,
    "onlinePaymentsEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'NETWORK',
    "address" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 9100,
    "width" INTEGER NOT NULL DEFAULT 80,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "localUuid" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "tenderedCents" INTEGER,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "onlinePaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localUuid" TEXT NOT NULL,
    "orderLocalUuid" TEXT NOT NULL,
    "numSerie" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "issueDate" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "tableLabel" TEXT NOT NULL,
    "waiterName" TEXT,
    "lines" JSONB NOT NULL,
    "payments" JSONB NOT NULL,
    "chainSeq" INTEGER,
    "issuerNif" TEXT,
    "hash" TEXT,
    "recordXml" TEXT,
    "qrUrl" TEXT,
    "environment" TEXT,
    "aeatStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "aeatErrorCode" TEXT,
    "aeatError" TEXT,
    "aeatSentAt" TIMESTAMP(3),
    "submissionId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AeatSubmission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "csv" TEXT,
    "waitSeconds" INTEGER,
    "records" INTEGER NOT NULL,
    "error" TEXT,
    "responseXml" TEXT,

    CONSTRAINT "AeatSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlinePayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "orderLocalUuid" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "applyResult" TEXT,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "localPaymentUuid" TEXT,

    CONSTRAINT "OnlinePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Printer_tenantId_name_key" ON "Printer"("tenantId", "name");

-- CreateIndex
CREATE INDEX "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_aeatStatus_idx" ON "Invoice"("tenantId", "aeatStatus");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_issuedAt_idx" ON "Invoice"("tenantId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_localUuid_key" ON "Invoice"("tenantId", "localUuid");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_numSerie_key" ON "Invoice"("tenantId", "numSerie");

-- CreateIndex
CREATE INDEX "AeatSubmission_tenantId_sentAt_idx" ON "AeatSubmission"("tenantId", "sentAt");

-- CreateIndex
CREATE INDEX "OnlinePayment_tenantId_status_idx" ON "OnlinePayment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "EmailMessage_status_createdAt_idx" ON "EmailMessage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_invoiceId_to_key" ON "EmailMessage"("invoiceId", "to");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tenantId_seriesNumber_key" ON "Device"("tenantId", "seriesNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_qrToken_key" ON "DiningTable"("qrToken");

-- AddForeignKey
ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_receiptPrinterId_fkey" FOREIGN KEY ("receiptPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AeatSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AeatSubmission" ADD CONSTRAINT "AeatSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

