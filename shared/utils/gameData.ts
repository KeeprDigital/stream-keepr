import type { Game } from '../types/enums';
import type { MtgPlayerGameData, OpPlayerGameData, PlayerGameData } from '../types/game';

/**
 * Checks if the data has the discriminator `type` field.
 * Legacy data stored before the discriminator was added may lack it.
 */
function hasDiscriminator(data: unknown): data is { type: string } {
	return typeof data === 'object' && data !== null && 'type' in data;
}

export function getMtgGameData(
	gameData: PlayerGameData | null | undefined,
): MtgPlayerGameData {
	if (!gameData)
		return { type: 'mtg', deckName: null, deckColors: null };
	// Discriminator check, with legacy fallback (no `type` field = treat as mtg if it has deckName/deckColors)
	if (hasDiscriminator(gameData) && gameData.type !== 'mtg')
		return { type: 'mtg', deckName: null, deckColors: null };
	return { ...gameData, type: 'mtg' };
}

export function getOpGameData(
	gameData: PlayerGameData | null | undefined,
): OpPlayerGameData {
	if (!gameData)
		return { type: 'op', leader: null };
	if (hasDiscriminator(gameData) && gameData.type !== 'op')
		return { type: 'op', leader: null };
	return { ...gameData, type: 'op' };
}

/** Get the display label for a player's game-specific identity (deck name or leader) */
export function getPlayerIdentityValue(
	game: Game,
	gameData: PlayerGameData | null | undefined,
): string | null {
	if (!gameData)
		return null;
	// Use discriminator if available, otherwise fall back to game param
	if (hasDiscriminator(gameData)) {
		switch (gameData.type) {
			case 'mtg':
				return (gameData as MtgPlayerGameData).deckName ?? null;
			case 'op':
				return (gameData as OpPlayerGameData).leader ?? null;
			default:
				return null;
		}
	}
	// Legacy fallback: use the game parameter
	switch (game) {
		case 'mtg':
			return (gameData as MtgPlayerGameData).deckName ?? null;
		case 'op':
			return (gameData as OpPlayerGameData).leader ?? null;
		default:
			return null;
	}
}
