DROP INDEX `graphics_ingestion_operations_idempotency_idx`;--> statement-breakpoint
-- `DEFAULT ''` is what makes this replayable: SQLite refuses an additive NOT NULL
-- column without a non-null default once a table holds rows, and this one ran
-- against an empty table only by accident of timing. No backfill follows because
-- nothing constrains this column to be distinct, and a Graphics Ingestion
-- Operation restored mid-flight has no proposed name to recover. See #310.
ALTER TABLE `graphics_ingestion_operations` ADD `proposed_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_ingestion_operations_author_idempotency_idx` ON `graphics_ingestion_operations` (`initiated_by`,`idempotency_key`);
