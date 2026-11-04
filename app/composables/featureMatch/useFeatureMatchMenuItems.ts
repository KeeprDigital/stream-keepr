import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { playerDisplayName } from '~~/shared/utils/playerName';

export interface FeatureMatchMenuItem {
	label: string;
	value: number;
	player1Name: string | null;
	player1DeckName: string | null;
	player1Colors: string | null;
	player2Name: string | null;
	player2DeckName: string | null;
	player2Colors: string | null;
}

function getPlayerLabel(
	playerData: { name?: string | null; nickname?: string | null; gameData?: unknown } | null | undefined,
): { name: string | null; deckName: string | null; colors: string | null } {
	const name = playerDisplayName(playerData);
	if (!playerData || !name)
		return { name: null, deckName: null, colors: null };
	const mtg = getMtgGameData(playerData.gameData as Parameters<typeof getMtgGameData>[0]);
	return {
		name,
		deckName: mtg.deckName ?? null,
		colors: mtg.deckColors ?? null,
	};
}

function formatMatchLabel(p1Name: string | null, p2Name: string | null, index: number): string {
	const prefix = `Match ${index + 1}`;
	if (!p1Name && !p2Name)
		return prefix;
	return `${prefix} — ${[p1Name ?? 'TBD', p2Name ?? 'TBD'].join(' vs ')}`;
}

/**
 * Each Feature Match Slot as a picker offers it, "A vs B", its players in the
 * order its followed Session seats them (ADR-0058).
 */
export function useFeatureMatchMenuItems() {
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();

	const items = computed<FeatureMatchMenuItem[]>(() => {
		return featureMatchStore.featureMatches.map((match, index) => {
			const slot = withFollowedFeatureMatchSession(match, featureMatchStateStore);
			const p1 = getPlayerLabel(featureMatchSidePlayer(slot, 'player1').data);
			const p2 = getPlayerLabel(featureMatchSidePlayer(slot, 'player2').data);

			return {
				label: formatMatchLabel(p1.name, p2.name, index),
				value: match.id,
				player1Name: p1.name,
				player1DeckName: p1.deckName,
				player1Colors: p1.colors,
				player2Name: p2.name,
				player2DeckName: p2.deckName,
				player2Colors: p2.colors,
			};
		});
	});

	return items;
}
