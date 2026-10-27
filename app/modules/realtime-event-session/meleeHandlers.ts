import type { AcceptRealtimeMessage } from './types';
import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createMeleeRealtimeHandlers({ accept }: Options) {
	const { refreshMeleeStructureData, refreshAfterMeleeReset } = useMeleeDataRefresh();
	const eventStore = useEventStore();

	/**
	 * These refreshes reload whole Event Data collections through the operator's
	 * private reads, so a rendering of a Screen — which holds only its output
	 * Event context, and no Session — skips them rather than drawing a 401 for
	 * each (#604). What a rendering re-reads after a sync is the Screen Mode data
	 * freshness work's to decide (#601–#603, #610).
	 */
	function operatorOnly<T>(handler: (data: T) => Promise<void>) {
		return async (data: T) => {
			if (!eventStore.event)
				return;
			await handler(data);
		};
	}

	return {
		'melee:structureSynced': accept('melee:structureSynced', operatorOnly(async (data) => {
			await refreshMeleeStructureData(data.eventId);
		})),
		'melee:dataReset': accept('melee:dataReset', operatorOnly(async (data) => {
			await refreshAfterMeleeReset(data.eventId);
		})),
		'melee:playersSynced': accept('melee:playersSynced', operatorOnly(async (data) => {
			useMetagameStore().applyRemoteInvalidated();
			await Promise.all([
				usePlayerStore().loadPlayersByEventId(data.eventId),
				useFeatureMatchStore().loadFeatureMatchesByEventId(data.eventId),
			]);
		})),
		'melee:featureMatchesSynced': accept('melee:featureMatchesSynced', operatorOnly(async (data) => {
			if (data.slotIds.length > 0)
				await useFeatureMatchStore().loadFeatureMatchesByEventId(data.eventId);
		})),
		'melee:decklistsSynced': accept('melee:decklistsSynced', operatorOnly(async (data) => {
			useMetagameStore().applyRemoteInvalidated();
			clearPlayerDeckCache();
			await Promise.all([
				usePlayerStore().loadPlayersByEventId(data.eventId),
				usePlayerDeckStore().loadByEventId(data.eventId),
				useFeatureMatchStore().loadFeatureMatchesByEventId(data.eventId),
			]);
		})),
		'melee:matchResultsSynced': accept('melee:matchResultsSynced', operatorOnly(async (data) => {
			await useMatchStore().applyRemoteMatchesRefreshed(data);
		})),
		'melee:pairingsSynced': accept('melee:pairingsSynced', operatorOnly(async (data) => {
			await Promise.all([
				useRoundStore().loadRoundsByEventId(data.eventId),
				useMatchStore().applyRemoteMatchesRefreshed(data),
				useFeatureMatchStore().loadFeatureMatchesByEventId(data.eventId),
			]);
		})),
		'melee:roundStandingsSynced': accept('melee:roundStandingsSynced', operatorOnly(async (data) => {
			await useRoundStore().loadRoundsByEventId(data.eventId);
		})),
		// Deprecated: every one is published beside a granular message above, so
		// following it too would reload twice. Kept only while the Event room's
		// handler map must name every message type.
		'melee:roundSynced': accept('melee:roundSynced', () => {}),
	};
}
