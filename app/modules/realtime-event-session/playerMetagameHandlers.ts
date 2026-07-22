import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createPlayerMetagameRealtimeHandlers({ accept }: Options) {
	return {
		'player:created': accept('player:created', (data) => {
			usePlayerStore().applyRemoteCreated(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'player:updated': accept('player:updated', (data) => {
			usePlayerStore().applyRemoteUpdated(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'player:deleted': accept('player:deleted', (data) => {
			usePlayerStore().applyRemoteDeleted(data);
			useMetagameStore().applyRemoteInvalidated();
		}),
		'playerDeck:reviewed': accept('playerDeck:reviewed', (data) => {
			usePlayerDeckStore().applyRemoteReviewed(data);
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
