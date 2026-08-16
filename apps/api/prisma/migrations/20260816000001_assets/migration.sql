-- CreateTable
CREATE TABLE "asset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA,
    "key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_ownerId_createdAt_idx" ON "asset"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

