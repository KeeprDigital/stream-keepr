CREATE TABLE `tcgplus_imported_deck_lists` (
	`player_id` integer PRIMARY KEY NOT NULL,
	`leader_card_number` text,
	`entries` text NOT NULL,
	`imported_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
