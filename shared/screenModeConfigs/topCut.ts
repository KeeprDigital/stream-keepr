import type { Game } from '../types/enums';
import type { ScreenModeConfigOf } from './contract';
import type { ScreenSettingsContext } from './fields';
import { z } from 'zod';
import { manualBracketPositionCounts } from '../modules/top-cut-bracket/manual';
import { TOP_CUT_BRACKET_SIZES } from '../modules/top-cut-bracket/seeding';
import { PLAYER_NAME_SHOWN_VALUES } from '../utils/playerName';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, headerConfigShape } from './subShapes';

export { TOP_CUT_BRACKET_SIZES } from '../modules/top-cut-bracket/seeding';

/** Where a Top Cut Bracket comes from: a Phase's Rounds, or a Manual Bracket (ADR-0075). */
export const TOP_CUT_BRACKET_SOURCE_VALUES = ['phase', 'manual'] as const;
export type TopCutBracketSource = typeof TOP_CUT_BRACKET_SOURCE_VALUES[number];

/** The longest name an operator may type for a Manual Bracket entrant. */
export const MANUAL_BRACKET_ENTRANT_NAME_MAX = 100;

/** The most games a side may be shown to have won in one Manual Bracket position. */
export const MANUAL_BRACKET_GAME_WINS_MAX = 9;

const manualBracketEntrantSchema = z.union([
	z.object({
		playerId: z.number().int().positive(),
	}).strict(),
	z.object({
		name: z.string().trim().min(1).max(MANUAL_BRACKET_ENTRANT_NAME_MAX),
	}).strict(),
]);

const gameWinsSchema = z.number().int().min(0).max(MANUAL_BRACKET_GAME_WINS_MAX);

const manualBracketResultSchema = z.object({
	winner: z.union([
		z.literal(0),
		z.literal(1),
	]),
	gameWins: z.tuple([gameWinsSchema, gameWinsSchema]).nullable().optional(),
}).strict();

/**
 * A Manual Bracket (ADR-0075): its size, its entrants by Seed, and the results
 * marked in each column by position. A bracket of `size` seats at most `size`
 * Seeds, and holds a column for each round to the Final, each half the last.
 */
export const manualBracketSchema = z.object({
	size: z.literal(TOP_CUT_BRACKET_SIZES),
	entrants: z.array(manualBracketEntrantSchema.nullable()).max(Math.max(...TOP_CUT_BRACKET_SIZES)),
	results: z.array(z.array(manualBracketResultSchema.nullable())),
}).strict().superRefine((manual, context) => {
	if (manual.entrants.length > manual.size) {
		context.addIssue({
			code: 'custom',
			path: ['entrants'],
			message: `A bracket of ${manual.size} seats at most ${manual.size} entrants`,
		});
	}
	const counts = manualBracketPositionCounts(manual.size);
	if (manual.results.length > counts.length) {
		context.addIssue({
			code: 'custom',
			path: ['results'],
			message: `A bracket of ${manual.size} has ${counts.length} columns`,
		});
	}
	manual.results.forEach((positions, column) => {
		const count = counts[column];
		if (count != null && positions.length > count) {
			context.addIssue({
				code: 'custom',
				path: ['results', column],
				message: `Column ${column + 1} holds ${count} positions`,
			});
		}
	});
});

/** Whether the bracket is a Phase's, as `topCutBracketSource` decides it: never on a One Piece Card Game Event. */
function readsPhase({ event, config }: ScreenSettingsContext): boolean {
	return event?.game !== 'op' && config.bracketSource === 'phase';
}

/**
 * The Top Cut Bracket Screen Mode's config contract: its shape, type, and defaults.
 *
 * The bracket is derived from the Phase the operator picks (#752); its size
 * comes from that Phase's first Round, unless `bracketSizeOverride` sets a
 * larger one (#906).
 *
 * Each Player's seed and Archetype are shown beside their name only when
 * turned on (#759), so a Screen saved before either existed renders as it did.
 * `playerNameShown` picks a One Piece Card Game Player's name or Nickname, the
 * other standing in when blank (ADR-0077); a saved Screen shows the name.
 *
 * `bracketSource` chooses the Phase or the Screen's own `manualBracket`, which
 * the operator fills in by hand (ADR-0075). The choice not taken is kept, so
 * switching back restores it. A One Piece Card Game Event holds no Phases, so
 * its Top Cut Bracket is always its Manual Bracket.
 */
export const topCutModeConfigContract = defineScreenModeConfigContract({
	bracketSource: editorField(z.enum(TOP_CUT_BRACKET_SOURCE_VALUES), {
		label: 'Bracket from',
		card: 'source',
		description: 'Derive the bracket from a Phase\'s Rounds and Match Results, or enter its entrants and results by hand.',
		options: { phase: 'A Phase', manual: 'Entered by hand' },
		// A One Piece Card Game Event holds no Phases, so it offers only the Manual Bracket (ADR-0075).
		showWhen: ({ event }) => event?.game !== 'op',
	}),
	phaseId: editorField(z.number().int().positive().optional(), {
		label: 'Phase',
		card: 'source',
		reference: 'phase',
		description: 'The bracket shows this Phase\'s Rounds in order, its first Round placed by each Player\'s Seed.',
		showWhen: readsPhase,
	}),
	manualBracket: editorField(manualBracketSchema, {
		label: 'Manual Bracket',
		card: 'live',
		reference: 'manualBracket',
		slot: 'manual-bracket',
		showWhen: context => !readsPhase(context),
	}),
	bracketSizeOverride: editorField(z.literal(TOP_CUT_BRACKET_SIZES).optional(), {
		label: 'Bracket size',
		card: 'source',
		slot: 'bracket-size',
		placeholder: 'From the first Round',
		description: 'Set it to show the byes the best Seeds take before the next Round is paired; a size smaller than the first Round needs is ignored.',
		showWhen: readsPhase,
	}),
	showSeeds: editorField(z.boolean(), {
		label: 'Show Seeds',
		card: 'content',
		group: 'entrants',
		description: context => readsPhase(context)
			? 'Show each Player\'s final position in the last Round Standings before this Phase.'
			: 'Show each entrant\'s Seed, their place in the Manual Bracket\'s list.',
	}),
	showArchetypes: editorField(z.boolean(), {
		label: 'Show archetypes',
		card: 'content',
		group: 'entrants',
		description: 'Show each Player\'s archetype under their name, or their Deck List\'s deck name; blank when they have neither.',
	}),
	playerNameShown: editorField(z.enum(PLAYER_NAME_SHOWN_VALUES), {
		label: 'Show Players by',
		card: 'content',
		group: 'entrants',
		description: 'Their name or their Nickname; a Player without the one chosen shows the other.',
		options: { name: 'Name', nickname: 'Nickname' },
		// Only a One Piece Card Game Player has a Nickname to show instead (ADR-0077).
		showWhen: ({ event }) => event?.game === 'op',
	}),
	...headerConfigShape({
		shows: 'Show a title above the bracket.',
		auto: 'Empty shows the Phase\'s name.',
	}),
}, {
	bracketSource: 'phase',
	phaseId: undefined,
	manualBracket: { size: 8, entrants: [], results: [] },
	bracketSizeOverride: undefined,
	showSeeds: false,
	showArchetypes: false,
	playerNameShown: 'name',
	...DEFAULT_HEADER_CONFIG,
}, {
	groups: {
		entrants: { title: 'Entrants', card: 'content' },
		bracket: { title: 'Bracket', card: 'content' },
		champion: { title: 'Champion', card: 'content' },
	},
});

export type TopCutModeConfig = ScreenModeConfigOf<typeof topCutModeConfigContract>;

/**
 * Where a Top Cut Bracket Screen's bracket comes from: the source its operator
 * chose, except on a One Piece Card Game Event, which holds no Phases, so its
 * bracket is always its Manual Bracket (ADR-0075).
 */
export function topCutBracketSource(game: Game | null | undefined, config: Pick<TopCutModeConfig, 'bracketSource'>): TopCutBracketSource {
	return game === 'op'
		? 'manual'
		: config.bracketSource;
}
