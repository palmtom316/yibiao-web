-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "phone" TEXT,
    "department" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "modules" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "projectCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "bidderName" TEXT,
    "subjectReplacements" TEXT,
    "ownerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastExportedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_configs" (
    "userId" INTEGER NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_configs_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "export_templates" (
    "templateId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "templateName" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_templates_pkey" PRIMARY KEY ("templateId")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "images" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_replies" (
    "id" SERIAL NOT NULL,
    "feedbackId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "images" JSONB,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docs_articles" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "docs_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_plan_meta" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "workflowKind" TEXT NOT NULL DEFAULT 'technical-plan',
    "step" TEXT NOT NULL DEFAULT 'document-analysis',
    "tenderFileName" TEXT,
    "tenderMarkdownPath" TEXT,
    "tenderMarkdownHash" TEXT,
    "tenderMarkdownChars" INTEGER NOT NULL DEFAULT 0,
    "tenderParserLabel" TEXT,
    "tenderImportedAt" TEXT,
    "tenderFilesJson" JSONB,
    "tenderOriginalMarkdownPath" TEXT,
    "tenderOriginalMarkdownHash" TEXT,
    "tenderOriginalMarkdownChars" INTEGER NOT NULL DEFAULT 0,
    "originalPlanFileName" TEXT,
    "originalPlanMarkdownPath" TEXT,
    "originalPlanMarkdownHash" TEXT,
    "originalPlanMarkdownChars" INTEGER NOT NULL DEFAULT 0,
    "originalPlanParserLabel" TEXT,
    "originalPlanImportedAt" TEXT,
    "pendingTenderMarkdownPath" TEXT,
    "pendingTenderFileName" TEXT,
    "pendingTenderParserLabel" TEXT,
    "pendingTenderSectionsJson" JSONB,
    "pendingTenderTotalDeclared" INTEGER,
    "bidAnalysisMode" TEXT NOT NULL DEFAULT 'key',
    "bidAnalysisSelectedTaskIdsJson" JSONB,
    "bidSectionMode" TEXT NOT NULL DEFAULT 'single',
    "bidSectionsJson" JSONB,
    "bidSectionExtractionStatus" TEXT NOT NULL DEFAULT 'idle',
    "bidSectionExtractionError" TEXT,
    "outlineMode" TEXT NOT NULL DEFAULT 'aligned',
    "outlineExpansionMode" TEXT NOT NULL DEFAULT 'ai-complement',
    "mirrorProcurementEnabled" BOOLEAN NOT NULL DEFAULT true,
    "outlineWordControlOptionsJson" JSONB,
    "outlineWordControlSnapshotJson" JSONB,
    "outlineProjectName" TEXT,
    "outlineProjectOverview" TEXT,
    "contentGenerationOptionsJson" JSONB,
    "contentGenerationRuntimeJson" JSONB,
    "contentIllustrationPlanJson" JSONB,
    "selectedSectionId" TEXT,
    "selectedSectionTitle" TEXT,
    "selectedSectionHeadLine" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "technical_plan_meta_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "technical_plan_tasks" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "type" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "logsJson" JSONB,
    "statsJson" JSONB,
    "error" TEXT,
    "pauseRequested" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "technical_plan_tasks_pkey" PRIMARY KEY ("projectId","type")
);

-- CreateTable
CREATE TABLE "technical_plan_bid_items" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "itemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "technical_plan_bid_items_pkey" PRIMARY KEY ("projectId","itemId")
);

-- CreateTable
CREATE TABLE "technical_plan_reference_docs" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "documentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "technical_plan_reference_docs_pkey" PRIMARY KEY ("projectId","documentId")
);

-- CreateTable
CREATE TABLE "technical_plan_outline_nodes" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "nodeId" TEXT NOT NULL,
    "parentNodeId" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sourceRequirementId" TEXT,
    "sourceRequirementTitle" TEXT,
    "knowledgeItemIdsJson" JSONB,
    "content" TEXT NOT NULL DEFAULT '',
    "isMirror" BOOLEAN NOT NULL DEFAULT false,
    "mirrorSourceText" TEXT,
    "outlineAttribute" TEXT,
    "contentMode" TEXT NOT NULL DEFAULT 'ai-generate',
    "contentModeNote" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "technical_plan_outline_nodes_pkey" PRIMARY KEY ("projectId","nodeId")
);

-- CreateTable
CREATE TABLE "technical_plan_content_sections" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "nodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "error" TEXT,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "technical_plan_content_sections_pkey" PRIMARY KEY ("projectId","nodeId")
);

-- CreateTable
CREATE TABLE "technical_plan_content_plans" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "nodeId" TEXT NOT NULL,
    "planJson" JSONB NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "technical_plan_content_plans_pkey" PRIMARY KEY ("projectId","nodeId")
);

-- CreateTable
CREATE TABLE "technical_plan_global_fact_groups" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "technical_plan_global_fact_groups_pkey" PRIMARY KEY ("projectId","groupId")
);

-- CreateTable
CREATE TABLE "knowledge_migration_meta" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legacyIndexHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "migratedFolderCount" INTEGER NOT NULL DEFAULT 0,
    "migratedDocumentCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TEXT,
    "completedAt" TEXT,
    "cleanupCompletedAt" TEXT,
    "error" TEXT,

    CONSTRAINT "knowledge_migration_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_folders" (
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "knowledge_folders_pkey" PRIMARY KEY ("folderId")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "documentId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "documentDir" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "markdownPath" TEXT NOT NULL,
    "markdownHash" TEXT,
    "markdownChars" INTEGER NOT NULL DEFAULT 0,
    "sourceExtension" TEXT,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "blockCount" INTEGER NOT NULL DEFAULT 0,
    "filteredBlockCount" INTEGER NOT NULL DEFAULT 0,
    "candidateItemCount" INTEGER NOT NULL DEFAULT 0,
    "discardedBlockCount" INTEGER NOT NULL DEFAULT 0,
    "systemDiscardedAfterRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lastBatchSize" INTEGER,
    "parserLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "knowledge_blocks" (
    "id" SERIAL NOT NULL,
    "documentId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "headingPathJson" JSONB,
    "content" TEXT NOT NULL,
    "contentChars" INTEGER NOT NULL DEFAULT 0,
    "isFiltered" INTEGER NOT NULL DEFAULT 0,
    "filterReason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "knowledge_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_candidate_items" (
    "id" SERIAL NOT NULL,
    "documentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "source" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "knowledge_candidate_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" SERIAL NOT NULL,
    "documentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "resume" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceFile" TEXT,
    "contentChars" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_item_blocks" (
    "id" SERIAL NOT NULL,
    "documentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "knowledge_item_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_discarded_groups" (
    "groupId" SERIAL NOT NULL,
    "documentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blockIdsJson" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "knowledge_discarded_groups_pkey" PRIMARY KEY ("groupId")
);

-- CreateTable
CREATE TABLE "knowledge_reports" (
    "documentId" TEXT NOT NULL,
    "totalBlocks" INTEGER NOT NULL DEFAULT 0,
    "filteredBlocksCount" INTEGER NOT NULL DEFAULT 0,
    "candidateItemsCount" INTEGER NOT NULL DEFAULT 0,
    "finalItemsCount" INTEGER NOT NULL DEFAULT 0,
    "matchedBlocksCount" INTEGER NOT NULL DEFAULT 0,
    "discardedBlocksCount" INTEGER NOT NULL DEFAULT 0,
    "systemDiscardedAfterRetryCount" INTEGER NOT NULL DEFAULT 0,
    "newItemsFromRecoveryCount" INTEGER NOT NULL DEFAULT 0,
    "recoveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "batchSize" INTEGER NOT NULL DEFAULT 20,
    "coverageRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchedRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "knowledge_reports_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "knowledge_document_steps" (
    "documentId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "resultJson" JSONB,
    "error" TEXT,
    "startedAt" TEXT,
    "completedAt" TEXT,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "knowledge_document_steps_pkey" PRIMARY KEY ("documentId","stepKey")
);

-- CreateTable
CREATE TABLE "knowledge_match_batches" (
    "documentId" TEXT NOT NULL,
    "batchIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "itemIdsJson" JSONB NOT NULL DEFAULT '[]',
    "matchesJson" JSONB,
    "error" TEXT,
    "startedAt" TEXT,
    "completedAt" TEXT,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "knowledge_match_batches_pkey" PRIMARY KEY ("documentId","batchIndex")
);

-- CreateTable
CREATE TABLE "asset_items" (
    "id" TEXT NOT NULL,
    "library" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "files" JSONB NOT NULL DEFAULT '[]',
    "expiryDate" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personnel_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "position" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personnel_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personnel_certificates" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "certName" TEXT NOT NULL,
    "certType" TEXT NOT NULL DEFAULT '',
    "files" JSONB NOT NULL DEFAULT '[]',
    "expiryDate" TIMESTAMP(3),
    "obtainedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personnel_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_check_meta" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "step" TEXT NOT NULL DEFAULT 'upload',
    "activeAnalysisTab" TEXT NOT NULL DEFAULT 'metadata',
    "currentSignature" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "duplicate_check_meta_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "duplicate_check_files" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "fileId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "modifiedAt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "duplicate_check_files_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "duplicate_check_tasks" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "type" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "logsJson" JSONB,
    "statsJson" JSONB,
    "error" TEXT,
    "payloadSignature" TEXT,
    "startedAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "duplicate_check_tasks_pkey" PRIMARY KEY ("projectId","type")
);

-- CreateTable
CREATE TABLE "duplicate_check_analysis_sections" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "section" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    "signature" TEXT,
    "statsJson" JSONB,
    "startedAt" TEXT,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "duplicate_check_analysis_sections_pkey" PRIMARY KEY ("projectId","section")
);

-- CreateTable
CREATE TABLE "duplicate_check_content_files" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "fileId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contentPath" TEXT,
    "contentLength" INTEGER NOT NULL DEFAULT 0,
    "parserLabel" TEXT,
    "error" TEXT,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "duplicate_check_content_files_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "duplicate_check_metadata_items" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "fileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "normalized" TEXT,
    "dateDay" TEXT,
    "comparable" INTEGER NOT NULL DEFAULT 0,
    "dateComparable" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "duplicate_check_metadata_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_check_outline_items" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "itemId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "parentItemId" TEXT,
    "level" INTEGER NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "pathTitlesJson" JSONB NOT NULL,
    "normalizedPath" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fromTender" INTEGER NOT NULL DEFAULT 0,
    "matchedTenderSentence" TEXT,

    CONSTRAINT "duplicate_check_outline_items_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "duplicate_check_outline_groups" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "groupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fileIdsJson" JSONB NOT NULL,
    "itemIdsJson" JSONB NOT NULL,
    "pathsJson" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "duplicate_check_outline_groups_pkey" PRIMARY KEY ("groupId")
);

-- CreateTable
CREATE TABLE "duplicate_check_outline_pairwise" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "fileAId" TEXT NOT NULL,
    "fileBId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "titleOverlap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pathOverlap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderSimilarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sharedCount" INTEGER NOT NULL DEFAULT 0,
    "risk" TEXT NOT NULL DEFAULT 'none',

    CONSTRAINT "duplicate_check_outline_pairwise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_check_content_duplicates" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "duplicateId" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "fileIdsJson" JSONB NOT NULL,
    "firstOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "duplicate_check_content_duplicates_pkey" PRIMARY KEY ("duplicateId")
);

-- CreateTable
CREATE TABLE "duplicate_check_content_occurrences" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "duplicateId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "duplicate_check_content_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_check_image_files" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "fileId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueImageCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "duplicate_check_image_files_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "duplicate_check_duplicate_images" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "imageId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "previewUrl" TEXT NOT NULL,
    "fileIdsJson" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "duplicate_check_duplicate_images_pkey" PRIMARY KEY ("imageId")
);

-- CreateTable
CREATE TABLE "duplicate_check_image_occurrences" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "imageId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "locationsJson" JSONB,

    CONSTRAINT "duplicate_check_image_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejection_check_meta" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "step" TEXT NOT NULL DEFAULT 'documents',
    "activeDocumentTab" TEXT NOT NULL DEFAULT 'tender',
    "activeResultTab" TEXT NOT NULL DEFAULT 'analysis',
    "activeCheckResultTab" TEXT NOT NULL DEFAULT 'rejection',
    "customCheckItems" TEXT NOT NULL DEFAULT '',
    "checkOptionsJson" JSONB,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "rejection_check_meta_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "rejection_check_documents" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "documentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "markdownPath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contentChars" INTEGER NOT NULL DEFAULT 0,
    "parserLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "rejection_check_documents_pkey" PRIMARY KEY ("projectId","documentId")
);

-- CreateTable
CREATE TABLE "rejection_check_tasks" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "type" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "logsJson" JSONB,
    "statsJson" JSONB,
    "error" TEXT,
    "startedAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "rejection_check_tasks_pkey" PRIMARY KEY ("projectId","type")
);

-- CreateTable
CREATE TABLE "rejection_check_extraction" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "content" TEXT NOT NULL DEFAULT '',
    "source" TEXT,
    "tenderSignature" TEXT,
    "error" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "rejection_check_extraction_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "rejection_check_results" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "resultType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "inputSignature" TEXT,
    "activeFindingId" TEXT,
    "progressMessage" TEXT,
    "error" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "rejection_check_results_pkey" PRIMARY KEY ("projectId","resultType")
);

-- CreateTable
CREATE TABLE "rejection_check_risk_findings" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "findingId" TEXT NOT NULL,
    "bidDocumentId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "bidEvidence" TEXT NOT NULL,
    "riskReason" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "rejection_check_risk_findings_pkey" PRIMARY KEY ("projectId","findingId")
);

-- CreateTable
CREATE TABLE "rejection_check_typo_findings" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "findingId" TEXT NOT NULL,
    "bidDocumentId" TEXT,
    "wrongText" TEXT NOT NULL,
    "correctText" TEXT NOT NULL,
    "originalExcerpt" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "locationHint" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "rejection_check_typo_findings_pkey" PRIMARY KEY ("projectId","findingId")
);

-- CreateTable
CREATE TABLE "rejection_check_logic_findings" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "findingId" TEXT NOT NULL,
    "bidDocumentId" TEXT,
    "title" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "locationHint" TEXT NOT NULL,
    "fallacyReason" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "rejection_check_logic_findings_pkey" PRIMARY KEY ("projectId","findingId")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "runnerKey" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "groupName" TEXT NOT NULL DEFAULT '',
    "output" TEXT NOT NULL DEFAULT 'markdown',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "promptText" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "builtin" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_diagnostic_runs" (
    "traceId" TEXT NOT NULL,
    "projectId" INTEGER,
    "userId" INTEGER,
    "taskId" TEXT,
    "taskType" TEXT,
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "requestMode" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'running',
    "stage" TEXT NOT NULL DEFAULT 'request',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_diagnostic_runs_pkey" PRIMARY KEY ("traceId")
);

-- CreateTable
CREATE TABLE "ai_diagnostic_attempts" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "requestChars" INTEGER NOT NULL DEFAULT 0,
    "requestMeta" JSONB,
    "responseChars" INTEGER NOT NULL DEFAULT 0,
    "responseHash" TEXT,
    "responseShape" JSONB,
    "issues" JSONB,
    "responseFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_diagnostic_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_deviation_workspaces" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'empty',
    "extractorVersion" TEXT NOT NULL DEFAULT '2026-08-14-v1',
    "tenderHash" TEXT NOT NULL DEFAULT '',
    "selectedSectionId" TEXT NOT NULL DEFAULT '',
    "selectedSectionTitle" TEXT NOT NULL DEFAULT '',
    "templateTitle" TEXT NOT NULL DEFAULT '',
    "templateKind" TEXT NOT NULL DEFAULT 'none',
    "templateSchemaJson" JSONB,
    "projectFieldsJson" JSONB,
    "sourceScopeJson" JSONB,
    "statsJson" JSONB,
    "generationTaskJson" JSONB,
    "orphanedRowsJson" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "response_deviation_workspaces_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "response_deviation_rows" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "sequenceNo" TEXT NOT NULL,
    "clauseNo" TEXT NOT NULL DEFAULT '',
    "requirementTitle" TEXT NOT NULL DEFAULT '',
    "requirementMarkdown" TEXT NOT NULL DEFAULT '',
    "requirementPlainText" TEXT NOT NULL DEFAULT '',
    "sourceEvidenceJson" JSONB,
    "sourceFingerprint" TEXT NOT NULL,
    "aggregation" TEXT NOT NULL DEFAULT 'numbered-clause',
    "confidence" TEXT NOT NULL DEFAULT 'high',
    "responseText" TEXT NOT NULL DEFAULT '',
    "deviationStatus" TEXT NOT NULL DEFAULT '',
    "deviationExplanation" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "manualEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "response_deviation_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "projects_projectCode_key" ON "projects"("projectCode");

-- CreateIndex
CREATE INDEX "projects_ownerId_updatedAt_idx" ON "projects"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "export_templates_userId_updatedAt_idx" ON "export_templates"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "export_templates_isShared_idx" ON "export_templates"("isShared");

-- CreateIndex
CREATE INDEX "feedbacks_userId_idx" ON "feedbacks"("userId");

-- CreateIndex
CREATE INDEX "feedbacks_status_createdAt_idx" ON "feedbacks"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "feedback_replies_feedbackId_createdAt_idx" ON "feedback_replies"("feedbackId", "createdAt");

-- CreateIndex
CREATE INDEX "docs_articles_section_sortOrder_idx" ON "docs_articles"("section", "sortOrder");

-- CreateIndex
CREATE INDEX "technical_plan_bid_items_projectId_idx" ON "technical_plan_bid_items"("projectId");

-- CreateIndex
CREATE INDEX "technical_plan_bid_items_sortOrder_idx" ON "technical_plan_bid_items"("sortOrder");

-- CreateIndex
CREATE INDEX "technical_plan_reference_docs_projectId_idx" ON "technical_plan_reference_docs"("projectId");

-- CreateIndex
CREATE INDEX "technical_plan_reference_docs_sortOrder_idx" ON "technical_plan_reference_docs"("sortOrder");

-- CreateIndex
CREATE INDEX "technical_plan_outline_nodes_projectId_idx" ON "technical_plan_outline_nodes"("projectId");

-- CreateIndex
CREATE INDEX "technical_plan_outline_nodes_parentNodeId_sortOrder_idx" ON "technical_plan_outline_nodes"("parentNodeId", "sortOrder");

-- CreateIndex
CREATE INDEX "technical_plan_outline_nodes_level_idx" ON "technical_plan_outline_nodes"("level");

-- CreateIndex
CREATE INDEX "technical_plan_content_sections_projectId_idx" ON "technical_plan_content_sections"("projectId");

-- CreateIndex
CREATE INDEX "technical_plan_content_sections_status_idx" ON "technical_plan_content_sections"("status");

-- CreateIndex
CREATE INDEX "technical_plan_content_plans_projectId_idx" ON "technical_plan_content_plans"("projectId");

-- CreateIndex
CREATE INDEX "technical_plan_global_fact_groups_projectId_idx" ON "technical_plan_global_fact_groups"("projectId");

-- CreateIndex
CREATE INDEX "technical_plan_global_fact_groups_sortOrder_idx" ON "technical_plan_global_fact_groups"("sortOrder");

-- CreateIndex
CREATE INDEX "knowledge_folders_sortOrder_createdAt_idx" ON "knowledge_folders"("sortOrder", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_documents_folderId_sortOrder_createdAt_idx" ON "knowledge_documents"("folderId", "sortOrder", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_documents_status_idx" ON "knowledge_documents"("status");

-- CreateIndex
CREATE INDEX "knowledge_blocks_documentId_isFiltered_sortOrder_idx" ON "knowledge_blocks"("documentId", "isFiltered", "sortOrder");

-- CreateIndex
CREATE INDEX "knowledge_blocks_documentId_blockId_idx" ON "knowledge_blocks"("documentId", "blockId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_blocks_documentId_blockId_isFiltered_key" ON "knowledge_blocks"("documentId", "blockId", "isFiltered");

-- CreateIndex
CREATE INDEX "knowledge_candidate_items_documentId_sortOrder_idx" ON "knowledge_candidate_items"("documentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_candidate_items_documentId_itemId_key" ON "knowledge_candidate_items"("documentId", "itemId");

-- CreateIndex
CREATE INDEX "knowledge_items_documentId_sortOrder_idx" ON "knowledge_items"("documentId", "sortOrder");

-- CreateIndex
CREATE INDEX "knowledge_items_title_idx" ON "knowledge_items"("title");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_items_documentId_itemId_key" ON "knowledge_items"("documentId", "itemId");

-- CreateIndex
CREATE INDEX "knowledge_item_blocks_documentId_itemId_sortOrder_idx" ON "knowledge_item_blocks"("documentId", "itemId", "sortOrder");

-- CreateIndex
CREATE INDEX "knowledge_item_blocks_documentId_blockId_idx" ON "knowledge_item_blocks"("documentId", "blockId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_item_blocks_documentId_itemId_blockId_key" ON "knowledge_item_blocks"("documentId", "itemId", "blockId");

-- CreateIndex
CREATE INDEX "knowledge_discarded_groups_documentId_source_sortOrder_idx" ON "knowledge_discarded_groups"("documentId", "source", "sortOrder");

-- CreateIndex
CREATE INDEX "knowledge_document_steps_documentId_status_idx" ON "knowledge_document_steps"("documentId", "status");

-- CreateIndex
CREATE INDEX "knowledge_match_batches_documentId_status_batchIndex_idx" ON "knowledge_match_batches"("documentId", "status", "batchIndex");

-- CreateIndex
CREATE INDEX "asset_items_library_expiryDate_idx" ON "asset_items"("library", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "asset_items_id_library_key" ON "asset_items"("id", "library");

-- CreateIndex
CREATE INDEX "personnel_certificates_profileId_expiryDate_idx" ON "personnel_certificates"("profileId", "expiryDate");

-- CreateIndex
CREATE INDEX "duplicate_check_files_projectId_idx" ON "duplicate_check_files"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_files_role_sortOrder_idx" ON "duplicate_check_files"("role", "sortOrder");

-- CreateIndex
CREATE INDEX "duplicate_check_content_files_projectId_idx" ON "duplicate_check_content_files"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_content_files_status_idx" ON "duplicate_check_content_files"("status");

-- CreateIndex
CREATE INDEX "duplicate_check_metadata_items_projectId_idx" ON "duplicate_check_metadata_items"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_metadata_items_fileId_sortOrder_idx" ON "duplicate_check_metadata_items"("fileId", "sortOrder");

-- CreateIndex
CREATE INDEX "duplicate_check_metadata_items_key_idx" ON "duplicate_check_metadata_items"("key");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_check_metadata_items_fileId_key_key" ON "duplicate_check_metadata_items"("fileId", "key");

-- CreateIndex
CREATE INDEX "duplicate_check_outline_items_projectId_idx" ON "duplicate_check_outline_items"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_outline_items_fileId_sortOrder_idx" ON "duplicate_check_outline_items"("fileId", "sortOrder");

-- CreateIndex
CREATE INDEX "duplicate_check_outline_items_normalizedTitle_normalizedPat_idx" ON "duplicate_check_outline_items"("normalizedTitle", "normalizedPath");

-- CreateIndex
CREATE INDEX "duplicate_check_outline_groups_projectId_idx" ON "duplicate_check_outline_groups"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_outline_groups_sortOrder_idx" ON "duplicate_check_outline_groups"("sortOrder");

-- CreateIndex
CREATE INDEX "duplicate_check_outline_pairwise_projectId_idx" ON "duplicate_check_outline_pairwise"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_outline_pairwise_score_idx" ON "duplicate_check_outline_pairwise"("score");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_check_outline_pairwise_fileAId_fileBId_key" ON "duplicate_check_outline_pairwise"("fileAId", "fileBId");

-- CreateIndex
CREATE INDEX "duplicate_check_content_duplicates_projectId_idx" ON "duplicate_check_content_duplicates"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_content_duplicates_firstOrder_idx" ON "duplicate_check_content_duplicates"("firstOrder");

-- CreateIndex
CREATE INDEX "duplicate_check_content_occurrences_projectId_idx" ON "duplicate_check_content_occurrences"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_content_occurrences_fileId_idx" ON "duplicate_check_content_occurrences"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_check_content_occurrences_duplicateId_fileId_key" ON "duplicate_check_content_occurrences"("duplicateId", "fileId");

-- CreateIndex
CREATE INDEX "duplicate_check_image_files_projectId_idx" ON "duplicate_check_image_files"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_duplicate_images_projectId_idx" ON "duplicate_check_duplicate_images"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_duplicate_images_hash_idx" ON "duplicate_check_duplicate_images"("hash");

-- CreateIndex
CREATE INDEX "duplicate_check_duplicate_images_sortOrder_idx" ON "duplicate_check_duplicate_images"("sortOrder");

-- CreateIndex
CREATE INDEX "duplicate_check_image_occurrences_projectId_idx" ON "duplicate_check_image_occurrences"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_check_image_occurrences_fileId_idx" ON "duplicate_check_image_occurrences"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_check_image_occurrences_imageId_fileId_key" ON "duplicate_check_image_occurrences"("imageId", "fileId");

-- CreateIndex
CREATE INDEX "rejection_check_documents_projectId_idx" ON "rejection_check_documents"("projectId");

-- CreateIndex
CREATE INDEX "rejection_check_documents_role_sortOrder_idx" ON "rejection_check_documents"("role", "sortOrder");

-- CreateIndex
CREATE INDEX "rejection_check_risk_findings_projectId_idx" ON "rejection_check_risk_findings"("projectId");

-- CreateIndex
CREATE INDEX "rejection_check_risk_findings_sortOrder_idx" ON "rejection_check_risk_findings"("sortOrder");

-- CreateIndex
CREATE INDEX "rejection_check_risk_findings_severity_idx" ON "rejection_check_risk_findings"("severity");

-- CreateIndex
CREATE INDEX "rejection_check_typo_findings_projectId_idx" ON "rejection_check_typo_findings"("projectId");

-- CreateIndex
CREATE INDEX "rejection_check_typo_findings_sortOrder_idx" ON "rejection_check_typo_findings"("sortOrder");

-- CreateIndex
CREATE INDEX "rejection_check_logic_findings_projectId_idx" ON "rejection_check_logic_findings"("projectId");

-- CreateIndex
CREATE INDEX "rejection_check_logic_findings_sortOrder_idx" ON "rejection_check_logic_findings"("sortOrder");

-- CreateIndex
CREATE INDEX "prompt_templates_runnerKey_enabled_sortOrder_idx" ON "prompt_templates"("runnerKey", "enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_runnerKey_itemKey_key" ON "prompt_templates"("runnerKey", "itemKey");

-- CreateIndex
CREATE INDEX "ai_diagnostic_runs_projectId_startedAt_idx" ON "ai_diagnostic_runs"("projectId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ai_diagnostic_runs_taskType_startedAt_idx" ON "ai_diagnostic_runs"("taskType", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ai_diagnostic_runs_status_startedAt_idx" ON "ai_diagnostic_runs"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ai_diagnostic_runs_expiresAt_idx" ON "ai_diagnostic_runs"("expiresAt");

-- CreateIndex
CREATE INDEX "ai_diagnostic_attempts_traceId_createdAt_idx" ON "ai_diagnostic_attempts"("traceId", "createdAt");

-- CreateIndex
CREATE INDEX "response_deviation_workspaces_userId_updatedAt_idx" ON "response_deviation_workspaces"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "response_deviation_rows_projectId_sortOrder_idx" ON "response_deviation_rows"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "response_deviation_rows_projectId_sourceFingerprint_idx" ON "response_deviation_rows"("projectId", "sourceFingerprint");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_templates" ADD CONSTRAINT "export_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedbacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs_articles" ADD CONSTRAINT "docs_articles_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_certificates" ADD CONSTRAINT "personnel_certificates_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "personnel_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_diagnostic_attempts" ADD CONSTRAINT "ai_diagnostic_attempts_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "ai_diagnostic_runs"("traceId") ON DELETE CASCADE ON UPDATE CASCADE;
