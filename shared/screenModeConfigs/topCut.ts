import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, headerConfigShape } from './subShapes';

/**
 * The Top Cut Bracket Screen Mode's config contract: its shape, type, and defaults.
 *
 * The bracket is derived from the Phase the operator picks (#752); its size
 * comes from that Phase's first Round, unless `bracketSizeOverride` sets a
 * larger one (#906). The placeholder `bracketSize` it once held is a former
 * field, which a stored Top Cut Bracket config may still carry, so the size
 * the operator sets has its own name.
 *
 * Each Player's seed and Archetype are shown beside their name only when
 * turned on (#759), so a Screen saved before either existed renders as it did.
 */
/** The bracket sizes an operator may set, each a power of two. */
export const TOP_CUT_BRACKET_SIZES = [4, 8, 16, 32] as const;

export const topCutModeConfigContract = defineScreenModeConfigContract({
	phaseId: z.number().int().positive().optional(),
	bracketSizeOverride: z.literal(TOP_CUT_BRACKET_SIZES).optional(),
	showSeeds: editorField(z.boolean(), { label: 'Show Seeds' }),
	showArchetypes: editorField(z.boolean(), { label: 'Show Archetypes' }),
	...headerConfigShape,
}, {
	phaseId: undefined,
	bracketSizeOverride: undefined,
	showSeeds: false,
	showArchetypes: false,
	...DEFAULT_HEADER_CONFIG,
}, {
	formerFields: ['bracketSize'],
});

export type TopCutModeConfig = ScreenModeConfigOf<typeof topCutModeConfigContract>;
