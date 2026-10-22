import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, headerConfigShape } from './subShapes';

/**
 * The Top Cut Screen Mode's config contract: its shape, type, and defaults.
 *
 * The bracket is derived from the Phase the operator picks (#752); its size
 * comes from that Phase's first Round. The placeholder `bracketSize` it once
 * held is a former field, which a stored Top Cut config may still carry.
 *
 * Each Player's seed and Archetype are shown beside their name only when
 * turned on (#759), so a Screen saved before either existed renders as it did.
 */
export const topCutModeConfigContract = defineScreenModeConfigContract({
	phaseId: z.number().int().positive().optional(),
	showSeeds: editorField(z.boolean(), { label: 'Show Seeds' }),
	showArchetypes: editorField(z.boolean(), { label: 'Show Archetypes' }),
	...headerConfigShape,
}, {
	phaseId: undefined,
	showSeeds: false,
	showArchetypes: false,
	...DEFAULT_HEADER_CONFIG,
}, { formerFields: ['bracketSize'] });

export type TopCutModeConfig = ScreenModeConfigOf<typeof topCutModeConfigContract>;
