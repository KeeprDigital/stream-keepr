import type { GraphicsHostToken } from './modules/graphics/hostContract';
import type { GraphicInputDeclaration, TextGraphicInputDeclaration } from './types/graphics';
import { MAX_GRAPHIC_TEXT_LENGTH } from './types/graphics';

/**
 * The Feature Match token binding catalogue.
 *
 * Feature Match Overlay declares no Graphic Inputs. Its Graphic Text Templates
 * name host-supplied tokens instead: the Host Contract carries this catalogue,
 * the editor offers exactly these keys, and the render model resolves their values
 * from the Feature Match Session and current Event Data. An author never declares,
 * renames, or deletes one.
 *
 * ## Why the keys name a side
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
 * - `{deckColors}` rendered colour pips rather than its own value. Its value is a
 *   colour string such as `WU`, which is what a Text Graphic Item renders; pips
 *   are a painted surface rather than text, so they are a Graphic Item's business
 *   rather than a placeholder's.
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

/**
 * Per-player tokens, named once and generated for each side.
 *
 * Generated rather than written twice: the two sides must offer the identical set,
 * and a token added to one side only would be one an author can place on one player
 * and not the other.
 */
const PLAYER_TOKENS = [
	{ suffix: 'Name', label: 'Name' },
	{ suffix: 'Record', label: 'Record' },
	{ suffix: 'Deck', label: 'Deck' },
	{ suffix: 'DeckColors', label: 'Deck Colours' },
	{ suffix: 'Pronouns', label: 'Pronouns' },
	{ suffix: 'Lgs', label: 'Local Game Store' },
] as const;

/** Tokens belonging to the Match, Round, or Event rather than to one player. */
const MATCH_TOKENS: readonly FeatureMatchToken[] = [
	{ key: 'round', label: 'Round' },
	{ key: 'stage', label: 'Stage' },
	{ key: 'table', label: 'Table' },
	{ key: 'format', label: 'Format' },
	{ key: 'eventName', label: 'Event Name' },
];

function playerTokens(side: 1 | 2): FeatureMatchToken[] {
	return PLAYER_TOKENS.map(token => ({
		key: `player${side}${token.suffix}`,
		label: `Player ${side} ${token.label}`,
	}));
}

export const FEATURE_MATCH_TOKEN_CATALOGUE: readonly FeatureMatchToken[] = [
	...playerTokens(1),
	...playerTokens(2),
	...MATCH_TOKENS,
];

export const FEATURE_MATCH_TOKEN_KEYS: readonly string[]
	= FEATURE_MATCH_TOKEN_CATALOGUE.map(token => token.key);

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
	return FEATURE_MATCH_TOKEN_CATALOGUE.map(token => ({
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

/** Type-level proof that a token declaration is an ordinary Graphic Input declaration. */
export type FeatureMatchTokenDeclaration = Extract<GraphicInputDeclaration, { type: 'text' }>;
