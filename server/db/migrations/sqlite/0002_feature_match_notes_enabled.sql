ALTER TABLE `events` ADD `feature_match_notes_enabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Hand-written: Events that existed before the toggle already use Feature Match Notes.
UPDATE `events` SET `feature_match_notes_enabled` = true;