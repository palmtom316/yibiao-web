-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "allowExternalProcessing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bidDeadline" DATE;

-- AlterTable
ALTER TABLE "technical_plan_meta" ADD COLUMN     "originalPlanSourceId" TEXT;

-- CreateTable
CREATE TABLE "document_sources" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER,
    "knowledgeDocumentId" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "currentParseVersion" INTEGER,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_parse_versions" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parser" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "sourceHash" TEXT NOT NULL,
    "markdownHash" TEXT,
    "markdownPath" TEXT,
    "chars" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_parse_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_assets" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER,
    "knowledgeDocumentId" TEXT,
    "parseId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'imported',
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "page" INTEGER,
    "block" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER,
    "knowledgeDocumentId" TEXT,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_sources_projectId_createdAt_idx" ON "document_sources"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "document_sources_knowledgeDocumentId_idx" ON "document_sources"("knowledgeDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_parse_versions_sourceId_version_key" ON "document_parse_versions"("sourceId", "version");

-- CreateIndex
CREATE INDEX "document_assets_projectId_idx" ON "document_assets"("projectId");

-- CreateIndex
CREATE INDEX "document_assets_knowledgeDocumentId_idx" ON "document_assets"("knowledgeDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_requestKey_key" ON "background_jobs"("requestKey");

-- CreateIndex
CREATE INDEX "background_jobs_projectId_status_idx" ON "background_jobs"("projectId", "status");

-- CreateIndex
CREATE INDEX "background_jobs_userId_createdAt_idx" ON "background_jobs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_knowledgeDocumentId_fkey" FOREIGN KEY ("knowledgeDocumentId") REFERENCES "knowledge_documents"("documentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_parse_versions" ADD CONSTRAINT "document_parse_versions_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "document_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_knowledgeDocumentId_fkey" FOREIGN KEY ("knowledgeDocumentId") REFERENCES "knowledge_documents"("documentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_parseId_fkey" FOREIGN KEY ("parseId") REFERENCES "document_parse_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_knowledgeDocumentId_fkey" FOREIGN KEY ("knowledgeDocumentId") REFERENCES "knowledge_documents"("documentId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_sources" ADD CONSTRAINT "document_source_scope" CHECK (("projectId" IS NULL) <> ("knowledgeDocumentId" IS NULL));
ALTER TABLE "document_assets" ADD CONSTRAINT "document_asset_scope" CHECK (("projectId" IS NULL) <> ("knowledgeDocumentId" IS NULL));
