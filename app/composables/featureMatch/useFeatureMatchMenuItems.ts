import type { EventKind } from '~~/shared/config/games';
import type { OpLeader } from '~~/shared/types/game';
import { eventSeats } from '~~/shared/config/games';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getMtgGameData, getOpGameData } from '~~/shared/utils/gameData';
import { playerDisplayName } from '~~/shared/utils/playerName';

export interface FeatureMatchMenuItem {
	label: string;
	value: number;
	player1Name: string | null;
	player1DeckName: string | null;
	player1Colors: string | null;
	/** A One Piece side's Leader, which names its deck. */
	player1Leader: OpLeader | null;
	player2Name: string | null;
	player2DeckName: string | null;
	player2Colors: string | null;
	player2Leader: OpLeader | null;
}

function getPlayerLabel(
	playerData: { name?: string | null; nickname?: string | null; gameData?: unknown } | null | undefined,
): { name: string | null; deckName: string | null; colors: string | null; leader: OpLeader | null } {
	const name = playerDisplayName(playerData);
	if (!playerData || !name) {
		return {
			name: null,
			deckName: null,
			colors: null,
			leader: null,
		};
	}
	const gameData = playerData.gameData as Parameters<typeof getMtgGameData>[0];
	const mtg = getMtgGameData(gameData);
	return {
		name,
		deckName: mtg.deckName ?? null,
		colors: mtg.deckColors ?? null,
		leader: getOpGameData(gameData).leader ?? null,
	};
}

/**
 * A Slot's label, "Match N — A vs B". A pair's empty side reads TBD; a
 * Commander Slot names every Seat somebody sits in and passes over an empty
 * one, which is not in the game (ADR-0087).
 */
function formatMatchLabel(names: Array<string | null>, kind: EventKind | undefined, index: number): string {
	const prefix = `Match ${index + 1}`;
	if (names.every(name => !name))
		return prefix;
	const shown = kind === 'mtg-commander'
		? names.filter((name): name is string => !!name)
		: names.map(name => name ?? 'TBD');
	return `${prefix} — ${shown.join(' vs ')}`;
}

/**
 * Each Feature Match Slot as a picker offers it, "A vs B", its players in the
 * order its followed Session seats them (ADR-0058), and a Commander Slot's
 * filled Seats in Seat order.
 */
export function useFeatureMatchMenuItems() {
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const eventKind = useEventKind();

	const items = computed<FeatureMatchMenuItem[]>(() => {
		return featureMatchStore.featureMatches.map((match, index) => {
			const slot = withFollowedFeatureMatchSession(match, featureMatchStateStore);
			const p1 = getPlayerLabel(featureMatchSidePlayer(slot, 'player1').data);
			const p2 = getPlayerLabel(featureMatchSidePlayer(slot, 'player2').data);

			const names = eventSeats(eventKind.value ?? 'mtg-two-player')
				.map(seat => playerDisplayName(featureMatchSidePlayer(slot, seat).data) || null);

			return {
				label: formatMatchLabel(names, eventKind.value, index),
				value: match.id,
				player1Name: p1.name,
				player1DeckName: p1.deckName,
				player1Colors: p1.colors,
				player1Leader: p1.leader,
				player2Name: p2.name,
				player2DeckName: p2.deckName,
				player2Colors: p2.colors,
				player2Leader: p2.leader,
			};
		});
	});

	return items;
}
