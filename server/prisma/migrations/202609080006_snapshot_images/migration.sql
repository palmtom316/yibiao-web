ALTER TABLE document_assets ADD COLUMN "referenceSnapshotId" TEXT;
ALTER TABLE document_assets ADD CONSTRAINT document_asset_snapshot_fk FOREIGN KEY ("referenceSnapshotId", "projectId") REFERENCES project_reference_snapshots(id, "projectId") ON DELETE CASCADE ON UPDATE CASCADE;
