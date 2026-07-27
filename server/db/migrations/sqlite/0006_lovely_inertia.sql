CREATE TABLE `graphics_canonical_write_candidates` (
	`operation_id` text NOT NULL,
	`digest` text NOT NULL,
	`byte_length` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`operation_id`, `digest`),
	FOREIGN KEY (`operation_id`) REFERENCES `graphics_ingestion_operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graphics_canonical_write_candidates_digest_idx` ON `graphics_canonical_write_candidates` (`digest`);