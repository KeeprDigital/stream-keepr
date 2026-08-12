-- `DEFAULT ''` on the two text columns is what makes this replayable: SQLite
-- refuses an additive NOT NULL column without a non-null default once a table
-- holds rows. A constant default is not sufficient on its own here, because the
-- unique index below would then see every pre-existing Screen Output carrying the
-- same digest — hence the backfill between them. See #310.
ALTER TABLE `screens` ADD `asset_capability_seed` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `screens` ADD `asset_capability_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `screens` ADD `asset_capability_digest` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- A no-op wherever the table was empty, which includes every database that has
-- already applied this migration. Where it does run, each half is chosen for a
-- different reason: the seed is the secret a Screen Output's asset capability is
-- derived from, so it must be unpredictable rather than merely distinct; the
-- digest only has to be unique, and this shape can never collide with a real one
-- because a real digest is 64 hex characters of SHA-256. A restored Screen Output
-- therefore comes back with no working capability — recoverable by rotating it —
-- rather than with one an onlooker could derive from its id.
UPDATE `screens` SET `asset_capability_seed` = lower(hex(randomblob(32))), `asset_capability_digest` = 'migrated-0007-' || `id`;--> statement-breakpoint
CREATE UNIQUE INDEX `screens_asset_capability_digest_idx` ON `screens` (`asset_capability_digest`);
