import type { Game } from '~~/shared/types/enums';

export type MeleeGameCompatibility
	= | { status: 'compatible'; meleeGame: Game }
		| { status: 'mismatch'; meleeGame: Game }
		| { status: 'unknown'; meleeGame: null };

// Melee's tournament API serializes the game as a PascalCase enum name
// (e.g. "MagicTheGathering"), so names are compared without separators to
// cover both display names and enum names.
function normalizeMeleeGameName(value: string): string {
	return value
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '');
}

/**
 * Maps only source game names whose meaning is unambiguous to an internal
 * game. Unknown names deliberately remain unknown so a future Melee game
 * cannot accidentally enter the MTG submitted-data adapter.
 */
export function mapMeleeGame(value: string): Game | null {
	const normalized = normalizeMeleeGameName(value);
	if (
		normalized === 'mtg'
		|| normalized === 'mtgarena'
		|| normalized.startsWith('magicthegathering')
	) {
		return 'mtg';
	}

	if (
		normalized === 'opcg'
		|| normalized.startsWith('onepiece')
	) {
		return 'op';
	}

	return null;
}

export function inspectMeleeGameCompatibility(
	eventGame: Game,
	meleeGameName: string,
): MeleeGameCompatibility {
	const meleeGame = mapMeleeGame(meleeGameName);
	if (!meleeGame)
		return { status: 'unknown', meleeGame: null };

	return meleeGame === eventGame
		? { status: 'compatible', meleeGame }
		: { status: 'mismatch', meleeGame };
}

export function unsupportedDeckListAdapterMessage(eventGame: Game): string {
	return eventGame === 'mtg'
		? 'Melee.gg reported an unrecognized game, so MTG Deck Lists were not imported'
		: 'Melee.gg Deck List import is not yet supported for this Event game';
}
