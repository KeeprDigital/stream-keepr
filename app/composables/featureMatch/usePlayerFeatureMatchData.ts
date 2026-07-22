import type { MaybeRefOrGetter } from 'vue';
import { formatOrdinal } from '~~/shared/utils/formatters';
import { getMtgGameData, getPlayerIdentityValue } from '~~/shared/utils/gameData';

/**
 * Resolves player-specific match data from stores.
 * Given a matchId and playerSide, returns computed refs for
 * player state, name, pronouns, deck name, bestOf, and seat label.
 *
 * This eliminates the need for parents to thread store-derivable
 * data down as individual props.
 */
export function usePlayerFeatureMatchData(
	matchId: MaybeRefOrGetter<number>,
	playerSide: MaybeRefOrGetter<PlayerSide>,
) {
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const eventStore = useEventStore();
	const playerStore = usePlayerStore();

	const mid = () => toValue(matchId);
	const side = () => toValue(playerSide);

	const match = computed(() => {
		return featureMatchStore.featureMatches.find(m => m.id === mid()) ?? null;
	});

	const matchState = computed(() => {
		return featureMatchStateStore.featureMatchStates.get(mid()) ?? null;
	});

	const activeSession = computed(() => {
		const sessionId = featureMatchStateStore.sessionIdBySlotId?.get(mid());
		if (sessionId) {
			return featureMatchStateStore.featureMatchSessions?.get(sessionId) ?? match.value?.activeSession ?? null;
		}
		return match.value?.activeSession ?? null;
	});

	const player = computed(() => {
		return matchState.value?.[side()] ?? null;
	});

	const playerData = computed(() => {
		const s = side();
		const snapshotPlayer = activeSession.value?.sourceSnapshot[s];
		if (snapshotPlayer)
			return snapshotPlayer.data;

		const m = match.value;
		if (!m)
			return null;
		return s === 'player1' ? m.player1Data : m.player2Data;
	});

	const playerName = computed(() => {
		const fallback = side() === 'player1' ? 'Player 1' : 'Player 2';
		return playerData.value?.name || fallback;
	});

	const playerPronouns = computed(() => {
		return playerData.value?.pronouns ?? undefined;
	});

	const game = computed(() => eventStore.event?.game ?? 'mtg');

	const deckName = computed(() => {
		if (game.value === 'mtg') {
			const playerId = side() === 'player1' ? match.value?.player1Id : match.value?.player2Id;
			const rosterPlayer = playerId
				? playerStore.players.find(p => p.id === playerId)
				: playerStore.players.find(p => p.name.toLowerCase() === playerName.value.toLowerCase());
			if (rosterPlayer) {
				return getMtgGameData(rosterPlayer.gameData).deckName ?? undefined;
			}
			return getMtgGameData(playerData.value?.gameData).deckName ?? undefined;
		}
		return getPlayerIdentityValue(game.value, playerData.value?.gameData) ?? undefined;
	});

	const bestOf = computed(() => {
		return activeSession.value?.sourceSnapshot.bestOf ?? match.value?.bestOf ?? 3;
	});

	const seatLabel = computed(() => {
		const orientation = eventStore.event?.featureMatchOrientation;
		if (orientation === 'vertical') {
			return side() === 'player1' ? 'Top' : 'Bottom';
		}
		return undefined;
	});

	const playerLgs = computed(() => {
		return playerData.value?.lgs ?? undefined;
	});

	const playerRecord = computed(() => {
		const data = playerData.value;
		const displayMode = activeSession.value?.sourceSnapshot.playerDisplayMode ?? match.value?.playerDisplayMode;
		if (!data || !displayMode)
			return undefined;
		const event = eventStore.event;

		if (displayMode === 'position') {
			const pos = data.position;
			if (pos === null || pos === undefined)
				return undefined;
			const num = typeof pos === 'number' ? pos : Number.parseInt(String(pos), 10);
			if (Number.isNaN(num))
				return String(pos);
			if (event?.displayPositionFormat === 'ordinal') {
				return formatOrdinal(num);
			}
			return String(num);
		}

		// Score mode: format as W-L-D
		const wins = data.wins ?? 0;
		const losses = data.losses ?? 0;
		const draws = data.draws ?? 0;
		const sep = event?.displayRecordSeparator ?? '-';
		const hideZeroDraws = event?.displayHideZeroDraws ?? true;
		if (hideZeroDraws && draws === 0) {
			return `${wins}${sep}${losses}`;
		}
		return `${wins}${sep}${losses}${sep}${draws}`;
	});

	return {
		match,
		matchState,
		player,
		playerName,
		playerPronouns,
		deckName,
		bestOf,
		seatLabel,
		playerLgs,
		playerRecord,
	};
}
