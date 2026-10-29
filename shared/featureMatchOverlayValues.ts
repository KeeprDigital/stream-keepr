import type { EventResponse, FeatureMatchResponse, MatchResponse, PhaseResponse, RoundResponse } from '~~/shared/api';
import type { PlayerSide } from '~~/shared/types/enums';
import { getGameConfig } from '~~/shared/config/games';
import { formatOrdinal } from '~~/shared/utils/formatters';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { formatPlayerRecord } from '~~/shared/utils/playerRecord';

/**
 * The values a Feature Match Overlay resolves for its Feature Match tokens.
 *
 * Shared so the Overlay and the public Feature Match read (ADR-0056) apply one
 * set of display rules to the same Slot.
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

export const FEATURE_MATCH_OVERLAY_TEMPLATE_TOKENS = [
	'name',
	'record',
	'deck',
	'deckColors',
	'pronouns',
	'lgs',
	'round',
	'stage',
	'table',
	'format',
	'eventName',
] as const;

export interface FeatureMatchOverlayTemplateMetadataInput {
	event: Pick<EventResponse, 'name' | 'game'> | null | undefined;
	featureMatch: Pick<FeatureMatchResponse, 'tableNumber' | 'roundName' | 'formatName' | 'activeSession'> | null | undefined;
	sourceMatch: Pick<MatchResponse, 'tableNumber'> | null | undefined;
	round: Pick<RoundResponse, 'name'> | null | undefined;
	phase: Pick<PhaseResponse, 'name'> | null | undefined;
}

export interface FeatureMatchOverlayTemplateMetadataValues {
	round: string;
	stage: string;
	table: string;
	format: string;
	eventName: string;
}

export function buildFeatureMatchOverlayTemplateMetadataValues({
	event,
	featureMatch,
	sourceMatch,
	round,
	phase,
}: FeatureMatchOverlayTemplateMetadataInput): FeatureMatchOverlayTemplateMetadataValues {
	const tableNumber = featureMatch?.tableNumber
		?? sourceMatch?.tableNumber
		?? featureMatch?.activeSession?.sourceSnapshot.tableNumber;
	const roundName = featureMatch?.roundName
		?? featureMatch?.activeSession?.sourceSnapshot.roundName
		?? round?.name
		?? '';
	const phaseName = phase?.name ?? '';

	return {
		round: roundName,
		stage: phaseName || roundName,
		table: tableNumber
			? `Table ${tableNumber}`
			: '',
		format: featureMatch?.formatName ?? featureMatch?.activeSession?.sourceSnapshot.formatName ?? (event?.game
			? getGameConfig(event.game).label
			: ''),
		eventName: event?.name ?? '',
	};
}

export interface FeatureMatchTokenValuesInput {
	event: Pick<EventResponse, 'name' | 'game' | 'displayRecordSeparator' | 'displayHideZeroDraws' | 'displayPositionFormat'> | null | undefined;
	featureMatch: FeatureMatchResponse | null | undefined;
	sourceMatch: Pick<MatchResponse, 'tableNumber'> | null | undefined;
	round: Pick<RoundResponse, 'name'> | null | undefined;
	phase: Pick<PhaseResponse, 'name'> | null | undefined;
}

/** The per-player token suffixes, in the order the catalogue generates them. */
const PLAYER_VALUE_KEYS = [
	'Name',
	'Record',
	'Deck',
	'DeckColors',
	'Pronouns',
	'Lgs',
] as const;

function playerData(input: FeatureMatchTokenValuesInput, side: PlayerSide) {
	return side === 'player1'
		? input.featureMatch?.player1Data
		: input.featureMatch?.player2Data;
}

/**
 * A Player's record slot, formatted in the mode selected for this Feature Match.
 *
 * Position mode deliberately replaces the record token so existing Layouts switch
 * between a score and a standing without needing a second authored Text Item. The
 * active Session's mode wins because its source snapshot is the on-air contract.
 */
function record(input: FeatureMatchTokenValuesInput, side: PlayerSide): string {
	const data = playerData(input, side);
	const displayMode = input.featureMatch?.activeSession?.sourceSnapshot.playerDisplayMode
		?? input.featureMatch?.playerDisplayMode
		?? 'score';
	if (displayMode === 'position') {
		if (data?.position == null)
			return '';
		return input.event?.displayPositionFormat === 'ordinal'
			? formatOrdinal(data.position)
			: String(data.position);
	}

	// An absent record renders empty rather than `0-0`: a Player with no results
	// yet and a Player who has lost nothing look identical otherwise.
	if (data?.wins == null && data?.losses == null && data?.draws == null)
		return '';

	return formatPlayerRecord(data, input.event);
}

function playerValues(
	input: FeatureMatchTokenValuesInput,
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
export function featureMatchTokenValues(input: FeatureMatchTokenValuesInput): Record<string, string> {
	const values: Record<string, string> = {};

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
