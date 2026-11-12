import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createPlayerMetagameRealtimeHandlers({ accept }: Options) {
	const eventStore = useEventStore();

	return {
		'player:created': accept('player:created', (data) => {
			usePlayerStore().applyRemoteCreated(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'player:updated': accept('player:updated', (data) => {
			usePlayerStore().applyRemoteUpdated(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		// An Archetype rename or delete names the Players it re-projected and carries
		// none (ADR-0084), so an operator re-reads the Players, as after a Melee
		// players sync. A rendering of a Screen has no operator Session, so it skips
		// the reload.
		'player:deckProjectionsChanged': accept('player:deckProjectionsChanged', async (data) => {
			useMetagameStore().applyRemoteInvalidated();
			if (!eventStore.event)
				return;
			await usePlayerStore().loadPlayersByEventId(data.eventId);
		}),
		'player:deleted': accept('player:deleted', (data) => {
			usePlayerStore().applyRemoteDeleted(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'playerDeck:reviewed': accept('playerDeck:reviewed', (data) => {
			usePlayerDeckStore().applyRemoteReviewed(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'playerDeck:cardsResolved': accept('playerDeck:cardsResolved', (data) => {
			usePlayerDeckStore().applyRemoteCardsResolved(data);
			useMetagameStore().applyRemoteInvalidated();
		}),

		'archetype:created': accept('archetype:created', (data) => {
			useArchetypeStore().applyRemoteCreated(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'archetype:updated': accept('archetype:updated', (data) => {
			useArchetypeStore().applyRemoteUpdated(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'archetype:deleted': accept('archetype:deleted', (data) => {
			useArchetypeStore().applyRemoteDeleted(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'archetype:keyCardsUpdated': accept('archetype:keyCardsUpdated', (data) => {
			useArchetypeStore().applyRemoteKeyCardsUpdated(data);
			useMetagameStore().applyRemoteInvalidated();
		}),

		'playerList:created': accept('playerList:created', data => usePlayerListStore().applyRemoteCreated(data)),
		'playerList:updated': accept('playerList:updated', data => usePlayerListStore().applyRemoteUpdated(data)),
		'playerList:deleted': accept('playerList:deleted', (data) => {
			usePlayerListStore().applyRemoteDeleted(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'playerList:membersChanged': accept('playerList:membersChanged', (data) => {
			usePlayerListStore().applyRemoteMembersChanged(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
	};
}
