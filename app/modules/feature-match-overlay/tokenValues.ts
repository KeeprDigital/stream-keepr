import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { GraphicInputValue } from '~~/shared/types/graphics';
import type { GraphicsFeatureMatchContext } from '~/modules/graphics/renderModel';
import type { Event, FeatureMatch, Match, Phase, Round } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { buildFeatureMatchOverlayTemplateMetadataValues } from '~/utils/featureMatchOverlayTemplateValues';

/**
 * What a Feature Match Overlay supplies to the shared compositor.
 *
 * Two things, resolved together because they read the same sources: the values
 * behind the Feature Match token binding catalogue, which answer a Graphic Text
 * Template's placeholders, and the live session state, which answers the
 * context-gated Clock, Player Life, and Game Wins Definitions.
 *
 * Resolved here rather than in the render model so the model stays pure. Every
 * Screen Output of one Screen resolves the same snapshot and derives the same
 * frame from it, which is what makes the Overlay, Fill, and Key Outputs agree.
 *
 * ## Why the token keys name a side
 *
 * The legacy model put the side on the item: a `playerSide` beside a `{name}`
 * token, so one key meant two values depending on which item rendered it. A shared
 * Text Graphic Item has no side, so the side moved into the key — `{player1Name}`
 * and `{player2Name}` are two catalogue entries, and the template says which
 * player it means. This module is where that translation happens: the per-side
 * values are resolved exactly as the legacy render model resolved them, then
 * written under prefixed keys.
 */

export interface FeatureMatchOverlayHostStateInput {
	event: Pick<Event, 'name' | 'game' | 'displayRecordSeparator' | 'displayHideZeroDraws'> | null | undefined;
	featureMatch: FeatureMatch | null | undefined;
	matchState: FeatureMatchState | null | undefined;
	sourceMatch: Pick<Match, 'tableNumber'> | null | undefined;
	round: Pick<Round, 'name'> | null | undefined;
	phase: Pick<Phase, 'name'> | null | undefined;
	/** The Feature Match Session clock, already formatted by its own composable. */
	displayTime: string;
}

/** The per-player token suffixes, in the order the catalogue generates them. */
const PLAYER_VALUE_KEYS = ['Name', 'Record', 'Deck', 'DeckColors', 'Pronouns', 'Lgs'] as const;

function playerData(input: FeatureMatchOverlayHostStateInput, side: PlayerSide) {
	return side === 'player1' ? input.featureMatch?.player1Data : input.featureMatch?.player2Data;
}

/**
 * A Player's record, formatted the way this Event displays one.
 *
 * An absent record renders empty rather than `0-0`: a Player with no results yet
 * and a Player who has lost nothing look identical otherwise.
 */
function record(input: FeatureMatchOverlayHostStateInput, side: PlayerSide): string {
	const data = playerData(input, side);
	if (data?.wins == null && data?.losses == null && data?.draws == null)
		return '';

	const wins = data.wins ?? 0;
	const losses = data.losses ?? 0;
	const draws = data.draws ?? 0;
	const separator = input.event?.displayRecordSeparator ?? '-';
	const hideZeroDraws = input.event?.displayHideZeroDraws ?? true;

	return hideZeroDraws && draws === 0
		? `${wins}${separator}${losses}`
		: `${wins}${separator}${losses}${separator}${draws}`;
}

function playerValues(
	input: FeatureMatchOverlayHostStateInput,
	side: PlayerSide,
): Record<typeof PLAYER_VALUE_KEYS[number], string> {
	const data = playerData(input, side);
	const mtg = getMtgGameData(data?.gameData as Parameters<typeof getMtgGameData>[0]);

	return {
		Name: data?.name ?? '',
		Record: record(input, side),
		Deck: mtg.deckName ?? '',
		DeckColors: mtg.deckColors ?? '',
		Pronouns: data?.pronouns ?? '',
		Lgs: data?.lgs ?? '',
	};
}

/**
 * The Feature Match token binding catalogue's values, keyed the way the catalogue
 * keys them.
 *
 * A missing value is an empty string rather than an absent key, because the shared
 * Graphic Text Template substitutes and nothing else. Legacy rendering trimmed
 * separators around a token that resolved empty; the shared mechanism does not, by
 * design, so an author composes `{player1Deck}` and `{player1DeckColors}` as
 * separate Graphic Items or a Graphic Group rather than relying on a string to
 * tidy itself.
 */
export function featureMatchTokenValues(
	input: FeatureMatchOverlayHostStateInput,
): Record<string, GraphicInputValue> {
	const values: Record<string, GraphicInputValue> = {};

	for (const side of ['player1', 'player2'] as const) {
		const resolved = playerValues(input, side);
		for (const key of PLAYER_VALUE_KEYS)
			values[`${side}${key}`] = resolved[key];
	}

	return {
		...values,
		...buildFeatureMatchOverlayTemplateMetadataValues({
			event: input.event,
			featureMatch: input.featureMatch,
			sourceMatch: input.sourceMatch,
			round: input.round,
			phase: input.phase,
		}),
	};
}

/**
 * The live session state the context-gated Definitions read.
 *
 * `bestOf` prefers the active Feature Match Session's own source snapshot over the
 * Slot's current value, so a Match promoted into the Slot mid-session cannot change
 * how many win boxes the session in progress draws.
 */
export function featureMatchGraphicsContext(
	input: FeatureMatchOverlayHostStateInput,
): GraphicsFeatureMatchContext {
	return {
		clockDisplayTime: input.displayTime,
		// `null` deck data until the deck card data path lands (#491): a Deck List
		// Graphic Item renders nothing rather than a placeholder sideboard.
		player1: {
			lifeTotal: input.matchState?.player1?.lifeTotal ?? null,
			gameWins: input.matchState?.player1?.gameWins ?? 0,
			sideboard: null,
		},
		player2: {
			lifeTotal: input.matchState?.player2?.lifeTotal ?? null,
			gameWins: input.matchState?.player2?.gameWins ?? 0,
			sideboard: null,
		},
		bestOf: input.featureMatch?.activeSession?.sourceSnapshot?.bestOf
			?? input.featureMatch?.bestOf
			?? 3,
	};
}
