-- CreateTable
CREATE TABLE "AdvisoryCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "commitHash" TEXT NOT NULL,
    "criterionIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "evidenceRefs" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvisoryCache_commitHash_criterionIndex_key" ON "AdvisoryCache"("commitHash", "criterionIndex");
