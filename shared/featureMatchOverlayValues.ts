import type { EventResponse, FeatureMatchResponse, MatchResponse, PhaseResponse, RoundResponse } from '~~/shared/api';
import type { Seat, Variant } from '~~/shared/types/enums';
import { eventKind, eventSeats, getGameConfig } from '~~/shared/config/games';
import { featureMatchTokenCatalogue } from '~~/shared/featureMatchTokenCatalogue';
import { formatOpColors } from '~~/shared/utils/card/op';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { formatOrdinal } from '~~/shared/utils/formatters';
import { getMtgGameData, getOpGameData } from '~~/shared/utils/gameData';
import { playerDisplayName } from '~~/shared/utils/playerName';
import { formatPlayerRecord } from '~~/shared/utils/playerRecord';
import { scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';

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
	/** Its Variant decides which Seats and terms it holds values for; absent reads as Two-Player. */
	event: (Pick<EventResponse, 'name' | 'game' | 'displayRecordSeparator' | 'displayHideZeroDraws' | 'displayPositionFormat'> & { variant?: Variant | null }) | null | undefined;
	featureMatch: FeatureMatchResponse | null | undefined;
	sourceMatch: Pick<MatchResponse, 'tableNumber'> | null | undefined;
	round: Pick<RoundResponse, 'name'> | null | undefined;
	phase: Pick<PhaseResponse, 'name'> | null | undefined;
}

/** Every per-Seat token suffix; an Event's catalogue says which of them it holds. */
type SeatValueKey = 'Name' | 'Record' | 'Deck' | 'DeckColors' | 'Pronouns' | 'Lgs' | 'LeaderImage' | 'Commander1Image' | 'Commander2Image';

/** The player a Seat shows, by the Session's side order while one is active (ADR-0058). */
function playerData(input: FeatureMatchTokenValuesInput, side: Seat) {
	return featureMatchSidePlayer(input.featureMatch, side).data;
}

/**
 * A Player's record slot, formatted in the mode selected for this Feature Match.
 *
 * Position mode deliberately replaces the record token so existing Layouts switch
 * between a score and a standing without needing a second authored Text Item. The
 * active Session's mode wins because its source snapshot is the on-air contract.
 */
function record(input: FeatureMatchTokenValuesInput, side: Seat): string {
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
	side: Seat,
): Record<SeatValueKey, string> {
	const data = playerData(input, side);
	// A Commander Seat's deck name and colours are its Commanders', as its setup save wrote them (ADR-0087).
	const mtg = getMtgGameData(data?.gameData);
	// A One Piece deck is named by its Leader, which also sets its colours, so a
	// Leader shows where a Magic deck name and its mana colours do.
	const leader = getOpGameData(data?.gameData).leader;
	const commanderImage = (index: number) => scryfallCardImageUrl(mtg.commanders?.[index]?.scryfallId) ?? '';

	return {
		Name: playerDisplayName(data),
		Record: record(input, side),
		Deck: mtg.deckName ?? leader?.name ?? '',
		DeckColors: mtg.deckColors ?? (leader
			? formatOpColors(leader.colors)
			: ''),
		Pronouns: data?.pronouns ?? '',
		Lgs: data?.lgs ?? '',
		LeaderImage: leader?.imageUrl ?? '',
		Commander1Image: commanderImage(0),
		Commander2Image: commanderImage(1),
	};
}

/**
 * The Feature Match token binding catalogue's values, keyed the way the catalogue
 * keys them.
 *
 * Exactly the tokens the Event's kind is offered: a Commander Event's four
 * Seats and their Commanders' images, and no record; any other Event's pair,
 * with no third Seat and no Commander term (ADR-0087). The public Feature Match
 * read returns every one (ADR-0056).
 *
 * A missing value is an empty string rather than an absent key, because the shared
 * Graphic Text Template substitutes and nothing else. Legacy rendering trimmed
 * separators around a token that resolved empty; the shared mechanism does not, by
 * design, so an author composes `{player1Deck}` and `{player1DeckColors}` as
 * separate Graphic Items or a Graphic Group rather than relying on a string to
 * tidy itself.
 */
export function featureMatchTokenValues(input: FeatureMatchTokenValuesInput): Record<string, string> {
	const kind = input.event
		? eventKind(input.event)
		: 'mtg-two-player';
	const offered = new Set(featureMatchTokenCatalogue(kind).map(token => token.key));
	const values: Record<string, string> = {};

	for (const seat of eventSeats(kind)) {
		for (const [key, value] of Object.entries(playerValues(input, seat))) {
			if (offered.has(`${seat}${key}`))
				values[`${seat}${key}`] = value;
		}
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
