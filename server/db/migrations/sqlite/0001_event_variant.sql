ALTER TABLE `events` ADD `variant` text;--> statement-breakpoint
-- Every Magic: The Gathering Event that exists is Two-Player; no other Card Game has a Variant (ADR-0086).
UPDATE `events` SET `variant` = 'two-player' WHERE `game` = 'mtg';
