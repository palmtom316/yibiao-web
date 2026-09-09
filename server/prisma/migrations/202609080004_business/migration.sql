-- CreateTable
CREATE TABLE "business_requirements" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "sourceLocator" TEXT NOT NULL DEFAULT '',
    "sectionId" TEXT NOT NULL DEFAULT '',
    "scopeFingerprint" TEXT NOT NULL,
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "referenceDate" DATE,
    "extractionVersion" INTEGER NOT NULL DEFAULT 1,
    "originKey" TEXT NOT NULL,
    "humanEdited" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" INTEGER NOT NULL,
    "updatedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_matches" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "requirementId" TEXT NOT NULL,
    "requirementVersion" INTEGER NOT NULL,
    "candidateType" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateVersion" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "scopeFingerprint" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL DEFAULT '',
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "confirmedByUserId" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "snapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_reference_snapshots" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "allowedUses" TEXT[],
    "files" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'staging',
    "error" TEXT,
    "confirmedByUserId" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshOfId" TEXT,

    CONSTRAINT "project_reference_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_response_revisions" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_response_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_revision_snapshots" (
    "revisionId" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "snapshotId" TEXT NOT NULL,

    CONSTRAINT "business_revision_snapshots_pkey" PRIMARY KEY ("revisionId","snapshotId")
);

-- CreateTable
CREATE TABLE "business_packages" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "revisionId" TEXT NOT NULL,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'staging',
    "relativePath" TEXT,
    "wordPath" TEXT,
    "sha256" TEXT,
    "wordHash" TEXT,
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_references" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "nodeId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT true,
    "insertedContentHash" TEXT NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_use_restrictions" (
    "documentId" TEXT NOT NULL,
    "performanceSourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_use_restrictions_pkey" PRIMARY KEY ("documentId","performanceSourceId")
);

-- CreateIndex
CREATE INDEX "business_requirements_projectId_active_createdAt_idx" ON "business_requirements"("projectId", "active", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_requirements_id_projectId_key" ON "business_requirements"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "business_requirements_projectId_originKey_extractionVersion_key" ON "business_requirements"("projectId", "originKey", "extractionVersion");

-- CreateIndex
CREATE INDEX "business_matches_requirementId_selected_idx" ON "business_matches"("requirementId", "selected");

-- CreateIndex
CREATE INDEX "business_matches_projectId_idx" ON "business_matches"("projectId");

-- CreateIndex
CREATE INDEX "project_reference_snapshots_projectId_status_idx" ON "project_reference_snapshots"("projectId", "status");

-- CreateIndex
CREATE INDEX "project_reference_snapshots_sourceType_sourceId_idx" ON "project_reference_snapshots"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "project_reference_snapshots_id_projectId_key" ON "project_reference_snapshots"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "business_response_revisions_requestKey_key" ON "business_response_revisions"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "business_response_revisions_id_projectId_key" ON "business_response_revisions"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "business_response_revisions_projectId_revision_key" ON "business_response_revisions"("projectId", "revision");

-- CreateIndex
CREATE INDEX "business_revision_snapshots_snapshotId_idx" ON "business_revision_snapshots"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "business_packages_revisionId_draft_key" ON "business_packages"("revisionId", "draft");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_references_projectId_nodeId_snapshotId_key" ON "chapter_references"("projectId", "nodeId", "snapshotId");

-- CreateIndex
CREATE INDEX "knowledge_use_restrictions_performanceSourceId_idx" ON "knowledge_use_restrictions"("performanceSourceId");

-- AddForeignKey
ALTER TABLE "business_requirements" ADD CONSTRAINT "business_requirements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_matches" ADD CONSTRAINT "business_matches_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_matches" ADD CONSTRAINT "business_matches_requirementId_projectId_fkey" FOREIGN KEY ("requirementId", "projectId") REFERENCES "business_requirements"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_matches" ADD CONSTRAINT "business_matches_snapshotId_projectId_fkey" FOREIGN KEY ("snapshotId", "projectId") REFERENCES "project_reference_snapshots"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reference_snapshots" ADD CONSTRAINT "project_reference_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_response_revisions" ADD CONSTRAINT "business_response_revisions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_revision_snapshots" ADD CONSTRAINT "business_revision_snapshots_revisionId_projectId_fkey" FOREIGN KEY ("revisionId", "projectId") REFERENCES "business_response_revisions"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_revision_snapshots" ADD CONSTRAINT "business_revision_snapshots_snapshotId_projectId_fkey" FOREIGN KEY ("snapshotId", "projectId") REFERENCES "project_reference_snapshots"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_packages" ADD CONSTRAINT "business_packages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_packages" ADD CONSTRAINT "business_packages_revisionId_projectId_fkey" FOREIGN KEY ("revisionId", "projectId") REFERENCES "business_response_revisions"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_references" ADD CONSTRAINT "chapter_references_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_references" ADD CONSTRAINT "chapter_references_snapshotId_projectId_fkey" FOREIGN KEY ("snapshotId", "projectId") REFERENCES "project_reference_snapshots"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX business_selected_match ON business_matches ("requirementId") WHERE selected = true;

ALTER TABLE technical_plan_outline_nodes ADD COLUMN "manualLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chapter_references ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
