-- CreateTable
CREATE TABLE "Printer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cloudId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'NETWORK',
    "address" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 9100,
    "width" INTEGER NOT NULL DEFAULT 80
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "tendered" REAL,
    "email" TEXT,
    "waiterId" INTEGER,
    "onlinePaymentId" TEXT,
    "refundAmount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "numSerie" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL,
    "issueDate" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "breakdown" TEXT NOT NULL,
    "chainSeq" INTEGER,
    "issuerNif" TEXT,
    "hash" TEXT,
    "recordXml" TEXT,
    "qrUrl" TEXT,
    "environment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "printerId" INTEGER,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LocalSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "json" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cloudId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "printerId" INTEGER,
    CONSTRAINT "Category_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Category" ("active", "cloudId", "id", "name", "sortOrder") SELECT "active", "cloudId", "id", "name", "sortOrder" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE UNIQUE INDEX "Category_cloudId_key" ON "Category"("cloudId");
CREATE TABLE "new_OrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "taxRate" REAL NOT NULL DEFAULT 10,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OrderLine" ("createdAt", "id", "note", "orderId", "productId", "qty", "status", "unitPrice") SELECT "createdAt", "id", "note", "orderId", "productId", "qty", "status", "unitPrice" FROM "OrderLine";
DROP TABLE "OrderLine";
ALTER TABLE "new_OrderLine" RENAME TO "OrderLine";
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cloudId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 10,
    "categoryId" INTEGER NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("active", "available", "categoryId", "cloudId", "id", "name", "price", "sortOrder") SELECT "active", "available", "categoryId", "cloudId", "id", "name", "price", "sortOrder" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_cloudId_key" ON "Product"("cloudId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Printer_cloudId_key" ON "Printer"("cloudId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_uuid_key" ON "Payment"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_onlinePaymentId_key" ON "Payment"("onlinePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_uuid_key" ON "Invoice"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_numSerie_key" ON "Invoice"("numSerie");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_chainSeq_key" ON "Invoice"("chainSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_series_number_key" ON "Invoice"("series", "number");

