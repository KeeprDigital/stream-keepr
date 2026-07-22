import type { AcceptRealtimeMessage } from './types';
import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createMeleeRealtimeHandlers({ accept }: Options) {
	const { refreshMeleeStructureData, refreshAfterMeleeReset } = useMeleeDataRefresh();

	return {
		'melee:structureSynced': accept('melee:structureSynced', async (data) => {
			await refreshMeleeStructureData(data.eventId);
		}),
		'melee:dataReset': accept('melee:dataReset', async (data) => {
			await refreshAfterMeleeReset(data.eventId);
		}),
		'melee:playersSynced': accept('melee:playersSynced', async (data) => {
			useMetagameStore().applyRemoteInvalidated();
			await Promise.all([
				usePlayerStore().loadPlayersByEventId(data.eventId),
				useFeatureMatchStore().loadFeatureMatchesByEventId(data.eventId),
			]);
		}),
		'melee:featureMatchesSynced': accept('melee:featureMatchesSynced', async (data) => {
			if (data.slotIds.length > 0)
				await useFeatureMatchStore().loadFeatureMatchesByEventId(data.eventId);
		}),
		'melee:decklistsSynced': accept('melee:decklistsSynced', async (data) => {
			useMetagameStore().applyRemoteInvalidated();
			clearPlayerDeckCache();
			await Promise.all([
				usePlayerStore().loadPlayersByEventId(data.eventId),
				usePlayerDeckStore().loadByEventId(data.eventId),
				useFeatureMatchStore().loadFeatureMatchesByEventId(data.eventId),
			]);
		}),
		'melee:roundSynced': accept('melee:roundSynced', async (data) => {
			await Promise.all([
				useRoundStore().loadRoundsByEventId(data.eventId),
				useMatchStore().applyRemoteMatchesRefreshed(data),
				useFeatureMatchStore().loadFeatureMatchesByEventId(data.eventId),
			]);
		}),
	};
}
