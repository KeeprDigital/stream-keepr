import type { ExternalSource, Game } from '../types/enums';

/** What a Player is shown by: the operator's name, and the TCG+ Nickname behind it. */
export interface PlayerNameFacts {
	name?: string | null;
	nickname?: string | null;
}

/** What a picker can find a Player by. */
export interface PlayerSearchFacts extends PlayerNameFacts {
	externalId?: string | null;
	externalSource?: ExternalSource | null;
}

/** Which of a Player's two names to show first: their name, or their Nickname. */
export const PLAYER_NAME_SHOWN_VALUES = ['name', 'nickname'] as const;
export type PlayerNameShown = typeof PLAYER_NAME_SHOWN_VALUES[number];

/**
 * A Player's name or Nickname, whichever `shown` asks for, the other standing
 * in when it is blank (ADR-0077), so a Player missing one still shows.
 */
export function playerShownName(player: PlayerNameFacts | null | undefined, shown: PlayerNameShown): string {
	const name = player?.name?.trim() ?? '';
	const nickname = player?.nickname?.trim() ?? '';
	return shown === 'nickname'
		? nickname || name
		: name || nickname;
}

/**
 * What fills a field that shows a Player's name, on air or in a Feature Match:
 * their name if an operator gave one, otherwise their Nickname (ADR-0077). A
 * Magic: The Gathering Player has no Nickname, so they always show by name.
 */
export function playerDisplayName(player: PlayerNameFacts | null | undefined): string {
	return playerShownName(player, 'name');
}

/**
 * How an operator screen (a list, picker or modal) tells a Player apart: their
 * Nickname, else their name (ADR-0077). Giving a One Piece Card Game Player a
 * name fills the fields that show it and never hides their Nickname here.
 */
export function playerLabel(player: PlayerNameFacts | null | undefined): string {
	return playerShownName(player, 'nickname');
}

/**
 * Why a Player as written could not be shown, or `null` when they can be
 * (ADR-0074). A One Piece Card Game Player shows by their name, else their
 * Nickname; a Magic: The Gathering Player has no Nickname, so needs a name.
 */
export function unshownPlayerReason(game: Game, player: PlayerNameFacts): string | null {
	if (game !== 'op' && player.nickname?.trim())
		return 'Only a One Piece Card Game Player has a Nickname';
	if (!playerDisplayName(player)) {
		return game === 'op'
			? 'A Player needs a name or a Nickname'
			: 'A Player needs a name';
	}
	return null;
}

/** A TCG+ Player's Bandai member number, which their Provenance is keyed by. */
export function playerMemberNumber(player: PlayerSearchFacts): string | null {
	return player.externalSource === 'tcgplus'
		? player.externalId ?? null
		: null;
}

/** Whether a picker's search finds this Player: by name, Nickname or Bandai member number. */
export function playerMatchesSearch(player: PlayerSearchFacts, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle)
		return true;
	return [
		player.name,
		player.nickname,
		playerMemberNumber(player),
	]
		.some(value => value?.toLowerCase().includes(needle));
}
