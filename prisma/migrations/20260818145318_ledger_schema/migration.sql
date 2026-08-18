-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "walletAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "onChainId" INTEGER,
    "clientId" INTEGER NOT NULL,
    "workerId" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "criteriaHash" TEXT NOT NULL,
    "criteriaJson" TEXT NOT NULL,
    "clientSignature" TEXT,
    "workerSignature" TEXT,
    "deadline" DATETIME NOT NULL,
    "reviewWindowEnds" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "outcome" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Agreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Agreement_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agreementId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "checkSpec" TEXT,
    CONSTRAINT "Criterion_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agreementId" INTEGER NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "commitHash" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evidence_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agreementId" INTEGER NOT NULL,
    "resultsHash" TEXT,
    "deterministicHash" TEXT,
    "resultsJson" TEXT,
    "outcome" TEXT,
    "engineVersion" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "error" TEXT,
    CONSTRAINT "Verification_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agreementId" INTEGER NOT NULL,
    "externalDisputeId" INTEGER,
    "raisedById" INTEGER NOT NULL,
    "reason" TEXT,
    "ruling" INTEGER,
    "rulingHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RAISED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Dispute_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agreementId" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerRef" TEXT,
    "intentRecordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    CONSTRAINT "Settlement_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agreementId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "txHash" TEXT,
    "blockNumber" INTEGER,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Outbox_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Agreement_onChainId_key" ON "Agreement"("onChainId");

-- CreateIndex
CREATE UNIQUE INDEX "Criterion_agreementId_index_key" ON "Criterion"("agreementId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_agreementId_key" ON "Settlement"("agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_idempotencyKey_key" ON "Settlement"("idempotencyKey");
