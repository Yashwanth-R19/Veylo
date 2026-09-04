-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "walletAddress" TEXT,
    "role" TEXT NOT NULL DEFAULT 'client',
    "oauthProvider" TEXT,
    "oauthId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" SERIAL NOT NULL,
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
    "deadline" TIMESTAMP(3) NOT NULL,
    "reviewWindowEnds" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "outcome" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" SERIAL NOT NULL,
    "agreementId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "checkSpec" TEXT,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" SERIAL NOT NULL,
    "agreementId" INTEGER NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "commitHash" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" SERIAL NOT NULL,
    "agreementId" INTEGER NOT NULL,
    "resultsHash" TEXT,
    "deterministicHash" TEXT,
    "resultsJson" TEXT,
    "outcome" TEXT,
    "engineVersion" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" SERIAL NOT NULL,
    "agreementId" INTEGER NOT NULL,
    "externalDisputeId" INTEGER,
    "raisedById" INTEGER NOT NULL,
    "reason" TEXT,
    "reasonHash" TEXT,
    "ruling" INTEGER,
    "rulingHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RAISED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" SERIAL NOT NULL,
    "agreementId" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "holdIdempotencyKey" TEXT,
    "holdRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "providerRef" TEXT,
    "settlementRefHash" TEXT,
    "intentRecordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatedProviderRecord" (
    "id" SERIAL NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "agreementId" INTEGER NOT NULL,
    "amountMinor" TEXT,
    "holdRef" TEXT,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatedProviderRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisoryCache" (
    "id" SERIAL NOT NULL,
    "commitHash" TEXT NOT NULL,
    "criterionIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidenceRefs" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisoryCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" SERIAL NOT NULL,
    "agreementId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "txHash" TEXT,
    "blockNumber" INTEGER,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "Settlement_holdIdempotencyKey_key" ON "Settlement"("holdIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_idempotencyKey_key" ON "Settlement"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedProviderRecord_idempotencyKey_key" ON "SimulatedProviderRecord"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AdvisoryCache_commitHash_criterionIndex_key" ON "AdvisoryCache"("commitHash", "criterionIndex");

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
