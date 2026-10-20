import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';

/**
 * The Event Data a Screen Output's Metagame aggregate is read from, for Screen
 * Mode Data Freshness: the Players in scope (their standing, activity and
 * Archetype), their reviewed Deck Lists, the Archetypes, and the Player List
 * scoping it. Melee syncs rewrite Players, Deck Lists and standings in bulk.
 *
 * These are the aggregate's own invalidations, not the Player store's: a deck
 * review or a Player List membership change re-reads without any Player record
 * changing (#602).
 *
 * @param playerListId The Player List the output is scoped to, if any.
 */
export function metagameAggregateDependencies<T>(playerListId: () => number | null | undefined): ScreenModeDependencies<T> {
	const scopesOutput = (listId: number) => listId === playerListId();

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
