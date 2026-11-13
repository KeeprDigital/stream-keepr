import type { Seat } from '~~/shared/types/enums';
import type { FeatureMatchFormData, Match } from '~/types';
import { toRaw } from 'vue';
import { getGameConfig } from '~~/shared/config/games';
import { DEFAULT_PLAYER_DATA } from '~/types';

const COMMANDER_SEAT_DATA_KEYS = ['player3Data', 'player4Data'] as const;

interface FeatureMatchSetupDeps {
	formData: Ref<FeatureMatchFormData>;
	getDeckForCurrentPhase: (
		playerId: number | null,
		defaultName: string | null,
		defaultColors: string | null,
	) => { name: string | null; colors: string | null };
}

/**
 * Composable for match setup actions: swap players, swap Seats, clear, populate from Melee.
 */
export function useFeatureMatchSetupActions(deps: FeatureMatchSetupDeps) {
	const eventStore = useEventStore();
	const roundStore = useRoundStore();
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const featureMatchRepository = useFeatureMatchRepository();
	const { runRequest } = useRequestFeedback();

	const { formData, getDeckForCurrentPhase } = deps;

	const meleeModalOpen = ref(false);

	/**
	 * Whether a Session command landed. The store resolves `null` for a command
	 * that failed, having reported why, so awaiting it is no proof it landed. It
	 * returns `null` outright when it sent nothing: no Session is held, or the
	 * same command is already in flight and answers for itself.
	 */
	async function landed(command: Promise<unknown> | null): Promise<boolean> {
		return command === null || (await command) !== null;
	}

	/**
	 * Swaps the sides in the Feature Match Session only. The Session owns which
	 * side each player sits on and the form holds the Slot's pairing order
	 * (ADR-0058), so the form is left alone: the panel shows it oriented by the
	 * Session, and a save sends each player's edits to their own Slot side.
	 */
	async function swapPlayers() {
		await runRequest(async () => {
			return !eventStore.eventId
				|| landed(featureMatchStateStore.swapPlayers(eventStore.eventId, formData.value.id));
		}, {
			success: { title: 'Players swapped', color: 'success' },
			error: { title: 'Failed to swap players', color: 'error' },
		});
	}

	/**
	 * Swap Seats (ADR-0086): two Seats' players change places in a Commander Slot
	 * itself, each with everything its Seat holds. The server swaps what it has
	 * stored, so the panel offers it only while the form has nothing unsaved, and
	 * the form follows the Slot the server answers.
	 */
	async function swapSeats(first: Seat, second: Seat) {
		const eventId = eventStore.eventId;
		if (!eventId)
			return;
		await runRequest(
			() => featureMatchRepository.swapSeats(eventId, formData.value.id, [first, second]),
			{
				success: { title: 'Seats swapped', color: 'success' },
				error: { title: 'Failed to swap Seats', color: 'error' },
				onSuccess: (slot) => {
					featureMatchStore.applySavedSlot(slot);
				},
			},
		);
	}

	async function clearMatch() {
		const snapshot = structuredClone(toRaw(formData.value));

		formData.value.player1Data = { ...DEFAULT_PLAYER_DATA };
		formData.value.player2Data = { ...DEFAULT_PLAYER_DATA };
		// Seats 3 and 4 are in a Commander Slot's form alone (ADR-0086).
		for (const key of COMMANDER_SEAT_DATA_KEYS) {
			if (formData.value[key] !== undefined)
				formData.value[key] = { ...DEFAULT_PLAYER_DATA };
		}
		formData.value.player1Id = null;
		formData.value.player2Id = null;
		formData.value.externalId = null;
		formData.value.externalSource = null;
		formData.value.roundName = null;
		formData.value.formatName = null;

		await runRequest(async () => {
			return !eventStore.eventId
				|| landed(featureMatchStateStore.resetMatch(eventStore.eventId, formData.value.id, { type: 'match' }));
		}, {
			success: { title: 'Match cleared', color: 'success' },
			error: { title: 'Failed to clear match', color: 'error' },
			onFailure: () => {
				// Rollback form data on failure
				formData.value.player1Data = snapshot.player1Data;
				formData.value.player2Data = snapshot.player2Data;
				for (const key of COMMANDER_SEAT_DATA_KEYS) {
					if (snapshot[key] !== undefined)
						formData.value[key] = snapshot[key];
				}
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

		const player1Deck = getDeckForCurrentPhase(match.player1Id, p1Data?.gameData?.type === 'mtg'
			? p1Data.gameData.deckName ?? null
			: null, p1Data?.gameData?.type === 'mtg'
			? p1Data.gameData.deckColors ?? null
			: null);
		const player2Deck = getDeckForCurrentPhase(match.player2Id, p2Data?.gameData?.type === 'mtg'
			? p2Data.gameData.deckName ?? null
			: null, p2Data?.gameData?.type === 'mtg'
			? p2Data.gameData.deckColors ?? null
			: null);

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
			return !eventStore.eventId
				|| landed(featureMatchStateStore.resetMatch(eventStore.eventId, formData.value.id, { type: 'match' }));
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
		swapSeats,
		clearMatch,
		populateFromMelee,
	};
}
