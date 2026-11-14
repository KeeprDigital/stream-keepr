import type { EventKind } from './config/games';
import type {
	GraphicsHostToken,
	GraphicsHostTokenPresentation,
} from './modules/graphics/hostContract';
import type { Seat } from './types/enums';
import type { GraphicInputDeclaration, TextGraphicInputDeclaration } from './types/graphics';
import { EVENT_KIND_CARD_GAME, EVENT_KIND_VALUES, eventSeats } from './config/games';
import { SEAT_VALUES } from './types/enums';
import { MAX_GRAPHIC_TEXT_LENGTH } from './types/graphics';
import { seatLabel } from './utils/featureMatchSidePlayer';

/**
 * The Feature Match token binding catalogue.
 *
 * Feature Match Overlay declares no Graphic Inputs. Its Graphic Text Templates
 * name host-supplied tokens instead: the Host Contract carries this catalogue,
 * the editor offers the keys its Event's kind holds, and the render model resolves their values
 * from the Feature Match Session and current Event Data. An author never declares,
 * renames, or deletes one.
 *
 * ## Why the keys name a Seat
 *
 * The legacy model put the side on the item — a `playerSide` beside a `{name}`
 * token — so one token key meant two different values depending on which item
 * rendered it. A shared Text Graphic Item has no side, and giving it one would
 * fork the shared vocabulary that `CONTEXT.md` says a Feature Match Layout speaks:
 * "Feature Match Layouts use the shared Graphic Item hierarchy rather than a
 * separate Layout Item or Widget hierarchy". So the side moves into the key:
 * `{player1Name}` and `{player2Name}` are two catalogue entries, and a template
 * says which player it means.
 *
 * ## What this catalogue deliberately does not carry
 *
 * Three legacy token behaviours are not tokens in the shared mechanism, and are
 * recorded here because the capability-parity checklist is verified against this
 * transition rather than against a memory of it:
 *
 * - `{spacer}` was layout expressed inside a string. A Graphic Group's gap,
 *   padding, and justification express it structurally instead.
 * - `{deckColors}` rendered colour pips rather than its own value. Its replacement
 *   remains a text token with a colour string such as `WU`, or `Red/Green` for a
 *   One Piece Leader, but the catalogue marks that run for the compositor's
 *   application-owned colour presentation of the Event's Card Game.
 *   The mark belongs to the host token rather than the string: an ordinary Graphic
 *   Input whose value happens to be `WU` must remain ordinary text.
 * - Legacy rendering trimmed separators around a token that resolved empty, so
 *   `{player1DeckColors} {player1Deck}` lost its leading space. The shared Graphic
 *   Text Template substitutes and nothing else, by design — it is a substitution
 *   rather than an evaluator.
 */

/**
 * One entry of this catalogue is an ordinary host token: the Host Contract owns
 * that shape, because the compositor reads it through the contract rather than
 * from here.
 */
export type FeatureMatchToken = GraphicsHostToken;

/** The Events whose Slots seat a pair: a record and a Leader's image are theirs alone. */
const PAIR_EVENTS: readonly EventKind[] = ['mtg-two-player', 'op'];
const COMMANDER_EVENTS: readonly EventKind[] = ['mtg-commander'];

/**
 * Per-Seat tokens, named once and generated for each Seat.
 *
 * Generated rather than written per Seat: every Seat of a Slot must offer the
 * identical set, and a token added to one Seat only would be one an author can
 * place on one player and not the next. `offeredTo` names the Events that hold
 * the value; absent means every Event. A Commander Event has no record, and
 * shows each Seat's Commanders where a One Piece Card Game Event shows a
 * Leader (ADR-0087).
 */
const SEAT_TOKENS: readonly {
	suffix: string;
	label: string;
	presentation?: FeatureMatchToken['presentation'];
	offeredTo?: readonly EventKind[];
}[] = [
	{ suffix: 'Name', label: 'Name' },
	{ suffix: 'Record', label: 'Record', offeredTo: PAIR_EVENTS },
	// A One Piece deck is named by its Leader, which also sets its colours; a
	// Commander deck by its Commanders, whose colour identity is its colours.
	{ suffix: 'Deck', label: 'Deck' },
	{
		suffix: 'DeckColors',
		label: 'Deck Colours',
		presentation: { mtg: 'mtg-mana-colors', op: 'op-colors' },
	},
	{ suffix: 'Pronouns', label: 'Pronouns' },
	{ suffix: 'Lgs', label: 'Local Game Store' },
	{
		suffix: 'LeaderImage',
		label: 'Leader Image',
		presentation: { op: 'op-card-image' },
		offeredTo: PAIR_EVENTS,
	},
	{
		suffix: 'Commander1Image',
		label: 'First Commander Image',
		presentation: { mtg: 'mtg-card-image' },
		offeredTo: COMMANDER_EVENTS,
	},
	{
		suffix: 'Commander2Image',
		label: 'Second Commander Image',
		presentation: { mtg: 'mtg-card-image' },
		offeredTo: COMMANDER_EVENTS,
	},
];

/** Tokens belonging to the Match, Round, or Event rather than to one player. */
const MATCH_TOKENS: readonly FeatureMatchToken[] = [
	{ key: 'round', label: 'Round' },
	{ key: 'stage', label: 'Stage' },
	{ key: 'table', label: 'Table' },
	{ key: 'format', label: 'Format' },
	{ key: 'eventName', label: 'Event Name' },
];

type SeatToken = typeof SEAT_TOKENS[number];

/** Whether an Event of this kind holds this token for this Seat: its Slots have the Seat, and it the value. */
function offers(kind: EventKind, seat: Seat, token: SeatToken): boolean {
	return eventSeats(kind).includes(seat) && (!token.offeredTo || token.offeredTo.includes(kind));
}

function seatToken(seat: Seat, token: SeatToken, kind: EventKind): FeatureMatchToken {
	return {
		key: `${seat}${token.suffix}`,
		label: `${seatLabel(kind, seat)} ${token.label}`,
		...(token.presentation
			? { presentation: token.presentation }
			: {}),
	};
}

/**
 * The tokens an Event of one kind is offered: what its editor lists and its
 * Slots resolve. A Two-Player or One Piece Card Game Event's are the pair's; a
 * Commander Event's are four Seats', with their Commanders' images and no
 * record (ADR-0087).
 */
export function featureMatchTokenCatalogue(kind: EventKind): readonly FeatureMatchToken[] {
	return [
		...SEAT_VALUES.flatMap(seat => SEAT_TOKENS
			.filter(token => offers(kind, seat, token))
			.map(token => seatToken(seat, token, kind))),
		...MATCH_TOKENS,
	];
}

/**
 * The whole vocabulary: every token some Event is offered. It is what a layout
 * may name and what a rendering declares, whatever Event it is drawn on.
 */
const FEATURE_MATCH_TOKEN_VOCABULARY: readonly FeatureMatchToken[] = [
	...SEAT_VALUES.flatMap(seat => SEAT_TOKENS
		.filter(token => EVENT_KIND_VALUES.some(kind => offers(kind, seat, token)))
		.map(token => seatToken(seat, token, 'mtg-commander'))),
	...MATCH_TOKENS,
];

export const FEATURE_MATCH_TOKEN_KEYS: readonly string[]
	= FEATURE_MATCH_TOKEN_VOCABULARY.map(token => token.key);

/**
 * The Seat each per-Seat token reads, by key. A token of the Match, Round or
 * Event reads none. It is how a rendering knows an empty Seat's text.
 */
export const FEATURE_MATCH_TOKEN_SEATS: Readonly<Record<string, Seat>> = Object.fromEntries(
	SEAT_VALUES.flatMap(seat => FEATURE_MATCH_TOKEN_KEYS
		.filter(key => key.startsWith(seat))
		.map(key => [key, seat] as const)),
);

export function isFeatureMatchTokenKey(key: string): boolean {
	return FEATURE_MATCH_TOKEN_KEYS.includes(key);
}

/**
 * The catalogue as the declarations the shared Graphic Text Template mechanism
 * already resolves against.
 *
 * An adapter rather than a stored shape: `renderGraphicTextTemplate` takes
 * `GraphicInputDeclaration`s, and a host token is exactly a text one whose value
 * the host supplies. Declaring the catalogue in that shape instead would carry four
 * fields nothing reads for a host token — `required`, `updatePolicy`, `default`,
 * and `maxLength` are a placed Broadcast Graphic's acceptance concerns, and a
 * Feature Match Overlay accepts nothing. So the catalogue stays two fields and pays
 * one function to speak the shared mechanism's language.
 */
export function featureMatchTokenDeclarations(): TextGraphicInputDeclaration[] {
	return FEATURE_MATCH_TOKEN_VOCABULARY.map(token => ({
		type: 'text',
		key: token.key,
		label: token.label,
		required: false,
		// A host token is resolved and rendered, never staged for an acceptance:
		// there is no Update Graphic on a Feature Match Overlay to accept it.
		updatePolicy: 'live',
		default: '',
		maxLength: MAX_GRAPHIC_TEXT_LENGTH,
	}));
}

/** Visual treatments the Feature Match host asks the shared compositor to paint on an Event of this kind. */
export function featureMatchTokenPresentations(kind: EventKind): Readonly<Record<string, GraphicsHostTokenPresentation>> {
	const game = EVENT_KIND_CARD_GAME[kind];
	return Object.fromEntries(
		featureMatchTokenCatalogue(kind).flatMap((token) => {
			const presentation = token.presentation?.[game];
			return presentation
				? [
						[token.key, presentation] as const,
					]
				: [];
		}),
	);
}

/** Type-level proof that a token declaration is an ordinary Graphic Input declaration. */
export type FeatureMatchTokenDeclaration = Extract<GraphicInputDeclaration, { type: 'text' }>;
