import type { FeatureMatchFormData, Match } from '~/types';
import { toRaw } from 'vue';
import { getGameConfig } from '~~/shared/config/games';
import { DEFAULT_PLAYER_DATA } from '~/types';

interface FeatureMatchSetupDeps {
	formData: Ref<FeatureMatchFormData>;
	getDeckForCurrentPhase: (
		playerId: number | null,
		defaultName: string | null,
		defaultColors: string | null,
	) => { name: string | null; colors: string | null };
}

/**
 * Composable for match setup actions: swap players, clear, populate from Melee.
 */
export function useFeatureMatchSetupActions(deps: FeatureMatchSetupDeps) {
	const eventStore = useEventStore();
	const roundStore = useRoundStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const { runRequest } = useRequestFeedback();

	const { formData, getDeckForCurrentPhase } = deps;

	const meleeModalOpen = ref(false);

	async function swapPlayers() {
		const snapshot = structuredClone(toRaw(formData.value));

		formData.value.player1Data = structuredClone(toRaw(snapshot.player2Data));
		formData.value.player2Data = structuredClone(toRaw(snapshot.player1Data));
		formData.value.player1Id = snapshot.player2Id;
		formData.value.player2Id = snapshot.player1Id;

		await runRequest(async () => {
			if (eventStore.eventId) {
				await featureMatchStateStore.swapPlayers(eventStore.eventId, formData.value.id);
			}
			return true;
		}, {
			success: { title: 'Players swapped', color: 'success' },
			error: { title: 'Failed to swap players', color: 'error' },
			onFailure: () => {
				// Rollback form data on failure
				formData.value.player1Data = snapshot.player1Data;
				formData.value.player2Data = snapshot.player2Data;
				formData.value.player1Id = snapshot.player1Id;
				formData.value.player2Id = snapshot.player2Id;
			},
		});
	}

	async function clearMatch() {
		const snapshot = structuredClone(toRaw(formData.value));

		formData.value.player1Data = { ...DEFAULT_PLAYER_DATA };
		formData.value.player2Data = { ...DEFAULT_PLAYER_DATA };
		formData.value.player1Id = null;
		formData.value.player2Id = null;
		formData.value.externalId = null;
		formData.value.externalSource = null;
		formData.value.roundName = null;
		formData.value.formatName = null;

		await runRequest(async () => {
			if (eventStore.eventId) {
				await featureMatchStateStore.resetMatch(eventStore.eventId, formData.value.id, { type: 'match' });
			}
			return true;
		}, {
			success: { title: 'Match cleared', color: 'success' },
			error: { title: 'Failed to clear match', color: 'error' },
			onFailure: () => {
				// Rollback form data on failure
				formData.value.player1Data = snapshot.player1Data;
				formData.value.player2Data = snapshot.player2Data;
				formData.value.player1Id = snapshot.player1Id;
				formData.value.player2Id = snapshot.player2Id;
				formData.value.externalId = snapshot.externalId;
				formData.value.externalSource = snapshot.externalSource;
				formData.value.roundName = snapshot.roundName;
				formData.value.formatName = snapshot.formatName;
			},
		});
	}

	async function populateFromMelee(match: Match) {
		if (eventStore.eventId) {
			if (!roundStore.isLoaded)
				await roundStore.loadRoundsByEventId(eventStore.eventId);
		}

		const p1Data = match.player1Data;
		const p2Data = match.player2Data;
		const sourceRound = roundStore.getRoundById(match.roundId);
		const defaultFormatName = getGameConfig(eventStore.event?.game ?? 'mtg').label;

		const player1Deck = getDeckForCurrentPhase(match.player1Id, p1Data?.gameData?.type === 'mtg' ? p1Data.gameData.deckName ?? null : null, p1Data?.gameData?.type === 'mtg' ? p1Data.gameData.deckColors ?? null : null);
		const player2Deck = getDeckForCurrentPhase(match.player2Id, p2Data?.gameData?.type === 'mtg' ? p2Data.gameData.deckName ?? null : null, p2Data?.gameData?.type === 'mtg' ? p2Data.gameData.deckColors ?? null : null);

		formData.value = {
			...formData.value,
			externalId: match.externalId,
			externalSource: match.externalSource,
			tableNumber: match.tableNumber,
			roundName: sourceRound?.name ?? formData.value.roundName ?? null,
			formatName: formData.value.formatName ?? defaultFormatName,
			player1Id: match.player1Id,
			player2Id: match.player2Id,
			player1Data: {
				...DEFAULT_PLAYER_DATA,
				name: p1Data?.name || 'TBD',
				pronouns: p1Data?.pronouns ?? undefined,
				wins: p1Data?.wins ?? undefined,
				losses: p1Data?.losses ?? undefined,
				draws: p1Data?.draws ?? undefined,
				position: p1Data?.position ?? undefined,
				gameData: {
					type: 'mtg',
					deckName: player1Deck.name,
					deckColors: player1Deck.colors,
				},
			},
			player2Data: {
				...DEFAULT_PLAYER_DATA,
				name: p2Data?.name || 'TBD',
				pronouns: p2Data?.pronouns ?? undefined,
				wins: p2Data?.wins ?? undefined,
				losses: p2Data?.losses ?? undefined,
				draws: p2Data?.draws ?? undefined,
				position: p2Data?.position ?? undefined,
				gameData: {
					type: 'mtg',
					deckName: player2Deck.name,
					deckColors: player2Deck.colors,
				},
			},
		};

		meleeModalOpen.value = false;

		await runRequest(async () => {
			if (eventStore.eventId) {
				await featureMatchStateStore.resetMatch(eventStore.eventId, formData.value.id, { type: 'match' });
			}
			return true;
		}, {
			success: {
				title: 'Match populated',
				description: `Populated from Table ${match.tableNumber ?? 'N/A'}`,
				color: 'success',
			},
			error: { title: 'Failed to reset match state', color: 'error' },
		});
	}

	return {
		meleeModalOpen,
		swapPlayers,
		clearMatch,
		populateFromMelee,
	};
}
