import type { MetagameScope } from '~~/shared/types/enums';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';

interface MetagameBreakdownScoping {
	scope: MetagameScope;
	playerListId?: number;
}

/**
 * The Event Data a Screen Output's Metagame breakdown is read from, for Screen
 * Mode Data Freshness: the Players in scope (their standing, activity and
 * Archetype), their reviewed Deck Lists, the Archetypes, and the Player List
 * scoping it. Melee syncs rewrite Players, Deck Lists and standings in bulk.
 *
 * These are the breakdown's own invalidations, not the Player store's: a deck
 * review or a Player List membership change re-reads without any Player record
 * changing (#602).
 */
export function metagameBreakdownDependencies(scoping: () => MetagameBreakdownScoping): ScreenModeDependencies<unknown> {
	// The server scopes by a Player List only while the scope names one.
	const scopesOutput = (listId: number) => {
		const { scope, playerListId } = scoping();
		return scope === 'playerList' && listId === playerListId;
	};

	return {
		'player:created': true,
		'player:updated': true,
		'player:deleted': true,
		'playerDeck:reviewed': true,
		'archetype:created': true,
		'archetype:updated': true,
		'archetype:deleted': true,
		'archetype:keyCardsUpdated': true,
		'playerList:membersChanged': ({ listId }) => scopesOutput(listId),
		'playerList:deleted': ({ listId }) => scopesOutput(listId),
		'melee:dataReset': true,
		'melee:playersSynced': true,
		'melee:decklistsSynced': true,
		'melee:roundSynced': true,
	};
}
