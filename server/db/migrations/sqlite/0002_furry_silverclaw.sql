DROP INDEX `graphics_ingestion_operations_idempotency_idx`;--> statement-breakpoint
ALTER TABLE `graphics_ingestion_operations` ADD `proposed_name` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_ingestion_operations_author_idempotency_idx` ON `graphics_ingestion_operations` (`initiated_by`,`idempotency_key`);