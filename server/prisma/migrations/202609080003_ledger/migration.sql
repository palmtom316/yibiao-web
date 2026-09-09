-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdByUserId" INTEGER,
ADD COLUMN     "updatedByUserId" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "knowledge_items" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdByUserId" INTEGER,
ADD COLUMN     "updatedByUserId" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "asset_items" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "category" TEXT,
ADD COLUMN     "certificateNo" TEXT,
ADD COLUMN     "createdByUserId" INTEGER,
ADD COLUMN     "holderName" TEXT,
ADD COLUMN     "issuer" TEXT,
ADD COLUMN     "qualificationLevel" TEXT,
ADD COLUMN     "updatedByUserId" INTEGER,
ADD COLUMN     "validFrom" DATE,
ADD COLUMN     "validityKind" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "personnel_profiles" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdByUserId" INTEGER,
ADD COLUMN     "updatedByUserId" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "personnel_certificates" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "certificateNo" TEXT,
ADD COLUMN     "createdByUserId" INTEGER,
ADD COLUMN     "issuer" TEXT,
ADD COLUMN     "qualificationLevel" TEXT,
ADD COLUMN     "updatedByUserId" INTEGER,
ADD COLUMN     "validFrom" DATE,
ADD COLUMN     "validityKind" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "performance_records" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "contractAmount" DECIMAL(20,2),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "contractSignedAt" DATE,
    "startedAt" DATE,
    "completedAt" DATE,
    "durationText" TEXT NOT NULL DEFAULT '',
    "roleText" TEXT NOT NULL DEFAULT '',
    "projectType" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPubliclyCitable" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_assets" (
    "recordId" TEXT NOT NULL,
    "assetItemId" TEXT NOT NULL,

    CONSTRAINT "performance_assets_pkey" PRIMARY KEY ("recordId","assetItemId")
);

-- CreateTable
CREATE TABLE "performance_knowledge_documents" (
    "recordId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "performance_knowledge_documents_pkey" PRIMARY KEY ("recordId","documentId")
);

-- CreateTable
CREATE TABLE "performance_knowledge_items" (
    "recordId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "performance_knowledge_items_pkey" PRIMARY KEY ("recordId","documentId","itemId")
);

-- CreateTable
CREATE TABLE "performance_team_members" (
    "recordId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "performance_team_members_pkey" PRIMARY KEY ("recordId","profileId","role")
);

-- CreateTable
CREATE TABLE "reference_revocations" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "throughVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "revokedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_personnel_migrations" (
    "sourceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "migratedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_personnel_migrations_pkey" PRIMARY KEY ("sourceId")
);

-- CreateIndex
CREATE INDEX "performance_records_archivedAt_updatedAt_idx" ON "performance_records"("archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "performance_records_projectType_idx" ON "performance_records"("projectType");

-- CreateIndex
CREATE INDEX "performance_assets_assetItemId_idx" ON "performance_assets"("assetItemId");

-- CreateIndex
CREATE INDEX "performance_knowledge_documents_documentId_idx" ON "performance_knowledge_documents"("documentId");

-- CreateIndex
CREATE INDEX "performance_knowledge_items_documentId_itemId_idx" ON "performance_knowledge_items"("documentId", "itemId");

-- CreateIndex
CREATE INDEX "performance_team_members_profileId_idx" ON "performance_team_members"("profileId");

-- CreateIndex
CREATE INDEX "reference_revocations_sourceType_sourceId_idx" ON "reference_revocations"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "audit_events_sourceType_sourceId_createdAt_idx" ON "audit_events"("sourceType", "sourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "performance_assets" ADD CONSTRAINT "performance_assets_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "performance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_assets" ADD CONSTRAINT "performance_assets_assetItemId_fkey" FOREIGN KEY ("assetItemId") REFERENCES "asset_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_knowledge_documents" ADD CONSTRAINT "performance_knowledge_documents_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "performance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_knowledge_documents" ADD CONSTRAINT "performance_knowledge_documents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("documentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_knowledge_items" ADD CONSTRAINT "performance_knowledge_items_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "performance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_knowledge_items" ADD CONSTRAINT "performance_knowledge_items_recordId_documentId_fkey" FOREIGN KEY ("recordId", "documentId") REFERENCES "performance_knowledge_documents"("recordId", "documentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_knowledge_items" ADD CONSTRAINT "performance_knowledge_items_documentId_itemId_fkey" FOREIGN KEY ("documentId", "itemId") REFERENCES "knowledge_items"("documentId", "itemId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_team_members" ADD CONSTRAINT "performance_team_members_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "performance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_team_members" ADD CONSTRAINT "performance_team_members_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "personnel_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE asset_items SET "validityKind" = 'dated' WHERE "expiryDate" IS NOT NULL;
UPDATE personnel_certificates SET "validityKind" = 'dated' WHERE "expiryDate" IS NOT NULL;
ALTER TABLE asset_items ADD CONSTRAINT asset_validity_kind CHECK ("validityKind" IN ('dated','permanent','unknown') AND ("validityKind" <> 'dated' OR "expiryDate" IS NOT NULL));
ALTER TABLE personnel_certificates ADD CONSTRAINT personnel_validity_kind CHECK ("validityKind" IN ('dated','permanent','unknown') AND ("validityKind" <> 'dated' OR "expiryDate" IS NOT NULL));
ALTER TABLE performance_records ADD CONSTRAINT performance_amount_nonnegative CHECK ("contractAmount" IS NULL OR "contractAmount" >= 0);
