import type { GraphicInputValue } from './types/graphics';
import { FEATURE_MATCH_TOKEN_KEYS } from './featureMatchTokenCatalogue';

/**
 * The canonical Feature Match sample dataset.
 *
 * One dataset, in one place, standing in for a Feature Match that is not there.
 * A Feature Match Layout is authored long before the show it will run, and a
 * Feature Match Layout Template is authored for no show at all — so the layout an
 * author is looking at while they position a name plate usually has no Slot behind
 * it, and every Graphic Text Template in it renders empty. An empty preview is not
 * a preview: it hides exactly the thing an author is judging, which is whether real
 * values fit inside the bounds they drew.
 *
 * ## Why it is canonical rather than plausible
 *
 * "Canonical" is doing work here. Two authors comparing the same layout must see
 * the same preview, and the same layout previewed before and after an edit must
 * differ only by the edit — so the values are fixed constants rather than sampled
 * from whatever the installation happens to hold, and there is one dataset rather
 * than one per Event, per preset, or per author.
 *
 * The values themselves are chosen to be *awkward in the ways real ones are*: a
 * long player name beside a short one, a two-word deck name, a record with a draw
 * in it, a life total that has gone negative-adjacent and a game-wins state partway
 * through a best-of-three. A dataset of `Player 1` and `0-0` would make every
 * layout look like it fits.
 *
 * ## Where it is used, and where it must never be
 *
 * Previews only, and only when nothing real is bound. A live Screen Output whose
 * Feature Match Slot holds no Match renders empty, exactly as it did before this
 * existed — putting sample values on air is the one failure this file must not
 * cause, so the choice is made by the preview surface rather than here.
 */

/**
 * The Feature Match token binding catalogue's values, sampled.
 *
 * Keyed by the catalogue's own keys, and complete over them: a token with no
 * sample value would preview as blank, which is the problem this dataset exists to
 * solve, so `featureMatchSampleDatasetIsComplete` proves the pair stay in step.
 */
export const FEATURE_MATCH_SAMPLE_TOKEN_VALUES: Readonly<Record<string, GraphicInputValue>> = {
	player1Name: 'Alexandra Whitfield-Moreau',
	player1Record: '5-1-1',
	player1Deck: 'Boros Convoke',
	player1DeckColors: 'RW',
	player1Pronouns: 'she/her',
	player1Lgs: 'Northgate Games',
	player2Name: 'Kenji Sato',
	player2Record: '6-1',
	player2Deck: 'Dimir Midrange',
	player2DeckColors: 'UB',
	player2Pronouns: 'he/him',
	player2Lgs: 'The Battered Sleeve',
	round: 'Round 8',
	stage: 'Quarterfinals',
	table: 'Table 1',
	format: 'Standard',
	eventName: 'Sample Regional Championship',
};

/** One sampled sideboard card. Art stays unset: a preview never fetches remotely. */
interface FeatureMatchSampleDeckListCard {
	name: string;
	quantity: number;
	imageUrl: string | null;
}

/** One sampled player's live session state. */
interface FeatureMatchSamplePlayerState {
	lifeTotal: number | null;
	gameWins: number;
	sideboard: FeatureMatchSampleDeckListCard[] | null;
}

/**
 * The live session state the context-gated Clock, Player Life, Game Wins, and
 * Deck List Graphic Item Definitions read.
 *
 * Structurally the same shape the render model takes, and deliberately not typed
 * as it: that type belongs to the client render model and this file is shared, so
 * the compiler checks the match where the two meet rather than by an import that
 * would point the wrong way.
 */
export interface FeatureMatchSampleContext {
	clockDisplayTime: string;
	player1: FeatureMatchSamplePlayerState;
	player2: FeatureMatchSamplePlayerState;
	bestOf: number;
}

export const FEATURE_MATCH_SAMPLE_CONTEXT: FeatureMatchSampleContext = {
	clockDisplayTime: '12:34',
	// The sideboards are awkward the way real ones are: a full fifteen cards with
	// a long name, a split card, and uneven quantities, so an author judging a
	// Deck List Graphic Item's bounds sees the worst case rather than a tidy one.
	// Art stays `null` — the canonical dataset never depends on a remote image —
	// so the preview shows the 63:88 text-placeholder cards.
	player1: {
		lifeTotal: 17,
		gameWins: 1,
		sideboard: [
			{ name: 'Rest in Peace', quantity: 2, imageUrl: null },
			{ name: 'Wear // Tear', quantity: 2, imageUrl: null },
			{ name: 'Pithing Needle', quantity: 1, imageUrl: null },
			{ name: 'Elspeth, Knight-Errant', quantity: 1, imageUrl: null },
			{ name: 'Celestial Purge', quantity: 3, imageUrl: null },
			{ name: 'Burrenton Forge-Tender', quantity: 4, imageUrl: null },
			{ name: 'Path to Exile', quantity: 2, imageUrl: null },
		],
	},
	player2: {
		lifeTotal: 4,
		gameWins: 1,
		sideboard: [
			{ name: 'Duress', quantity: 3, imageUrl: null },
			{ name: 'Negate', quantity: 2, imageUrl: null },
			{ name: 'Sheoldred, the Apocalypse', quantity: 2, imageUrl: null },
			{ name: 'Gix\'s Command', quantity: 2, imageUrl: null },
			{ name: 'Cut Down', quantity: 3, imageUrl: null },
			{ name: 'Disdainful Stroke', quantity: 3, imageUrl: null },
		],
	},
	bestOf: 3,
};

/**
 * Whether the sample dataset still covers the whole token catalogue.
 *
 * Exported as a function rather than asserted at module load: a preview rendering
 * one blank placeholder is a cosmetic gap, and refusing to load the application
 * over it would be a far worse failure than the one it prevents. The unit test is
 * where it is enforced.
 */
export function featureMatchSampleDatasetIsComplete(): boolean {
	return FEATURE_MATCH_TOKEN_KEYS.every(key => key in FEATURE_MATCH_SAMPLE_TOKEN_VALUES);
}
