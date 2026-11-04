import type { OpCardColor } from './card/op';
import type { OpDeckListWarning } from './opDeckList';

/**
 * A TCG+ Import (ADR-0074): a preview of what an export would change, and the
 * answer to importing it.
 */

/** A Player the export names, by their Bandai member number and Nickname. */
export interface TcgPlusImportedPlayer {
	memberNumber: string;
	nickname: string;
	leaderNumber: string | null;
}

/** A Player already in the Event, as the preview names them. */
export interface TcgPlusImportHeldPlayer {
	playerId: number;
	/** What the Player is shown by: their name, else their Nickname. */
	shownAs: string;
	memberNumber: string | null;
}

export interface TcgPlusImportLeader {
	number: string;
	/** `null` for a Leader bandai-keepr does not know. */
	name: string | null;
	colors: OpCardColor[];
	playerCount: number;
}

export interface TcgPlusImportPreview {
	playerCount: number;
	/** Players the import would add. */
	added: TcgPlusImportedPlayer[];
	/** Players whose Deck List the import would replace. */
	deckListChanged: TcgPlusImportHeldPlayer[];
	/** Imported Players missing from the export, who would be marked inactive. */
	deactivated: TcgPlusImportHeldPlayer[];
	/** How many Players bring each Leader, most first. */
	leaders: TcgPlusImportLeader[];
	warnings: {
		/** Deck rule breaches, which never refuse the import. */
		ruleBreaches: Array<TcgPlusImportedPlayer & { warnings: OpDeckListWarning[] }>;
		/** Card numbers bandai-keepr does not know, kept as Unresolved Deck Cards. */
		unknownCards: Array<{ number: string; playerCount: number }>;
		/** Hand-edited Deck Lists the export differs from, which the import keeps. */
		handEditConflicts: TcgPlusImportHeldPlayer[];
		/** Players added by hand whose name or Nickname matches an incoming Nickname. Nothing is merged. */
		possibleDuplicates: Array<TcgPlusImportHeldPlayer & { nickname: string; incomingMemberNumber: string }>;
	};
}

export interface TcgPlusImportResults {
	created: number;
	updated: number;
	deactivated: number;
	deckListsWritten: number;
	handEditsKept: number;
}

export interface TcgPlusImportAnswer {
	success: true;
	message: string;
	results: TcgPlusImportResults;
	warnings?: string[];
}
