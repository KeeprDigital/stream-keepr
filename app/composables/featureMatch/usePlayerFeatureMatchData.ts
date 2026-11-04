import type { MaybeRefOrGetter } from 'vue';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { formatOrdinal } from '~~/shared/utils/formatters';
import { getMtgGameData, getPlayerIdentityValue } from '~~/shared/utils/gameData';
import { playerDisplayName } from '~~/shared/utils/playerName';
import { formatPlayerRecord } from '~~/shared/utils/playerRecord';

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

	/** The Slot carrying the Session the Live State Follower holds for it, which owns side order (ADR-0058). */
	const followedSlot = computed(() => match.value
		? withFollowedFeatureMatchSession(match.value, featureMatchStateStore)
		: null);

	const activeSession = computed(() => followedSlot.value?.activeSession ?? null);

	const player = computed(() => {
		return matchState.value?.[side()] ?? null;
	});

	// The player this side shows, and the roster Player it links: a seat filled by hand links none.
	const seated = computed(() => featureMatchSidePlayer(followedSlot.value, side()));

	const playerData = computed(() => seated.value.data);

	const playerName = computed(() => {
		const fallback = side() === 'player1'
			? 'Player 1'
			: 'Player 2';
		return playerDisplayName(playerData.value) || fallback;
	});

	const seatedPlayerId = computed(() => seated.value.playerId);

	const linkedPlayer = computed(() => {
		const playerId = seatedPlayerId.value;
		return playerId
			? playerStore.players.find(p => p.id === playerId) ?? null
			: null;
	});

	const playerPronouns = computed(() => {
		return playerData.value?.pronouns ?? undefined;
	});

	const game = computed(() => eventStore.displayEvent?.game ?? 'mtg');

	const deckName = computed(() => {
		if (game.value === 'mtg') {
			const playerId = seatedPlayerId.value;
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
		const orientation = eventStore.displayEvent?.featureMatchOrientation;
		if (orientation === 'vertical') {
			return side() === 'player1'
				? 'Top'
				: 'Bottom';
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
		const event = eventStore.displayEvent;

		if (displayMode === 'position') {
			const pos = data.position;
			if (pos === null || pos === undefined)
				return undefined;
			const num = typeof pos === 'number'
				? pos
				: Number.parseInt(String(pos), 10);
			if (Number.isNaN(num))
				return String(pos);
			if (event?.displayPositionFormat === 'ordinal') {
				return formatOrdinal(num);
			}
			return String(num);
		}

		// Score mode: format as W-L-D
		return formatPlayerRecord(data, event);
	});

	return {
		match,
		matchState,
		player,
		playerName,
		linkedPlayer,
		playerPronouns,
		deckName,
		bestOf,
		seatLabel,
		playerLgs,
		playerRecord,
	};
}
