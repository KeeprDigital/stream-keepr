import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { BOARD_SELECTION_VALUES, METAGAME_CONVERSION_METRIC_VALUES } from '../types/enums';
import { CARD_TYPE_BUCKET_ORDER } from '../utils/metagame';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, DEFAULT_METAGAME_SCOPE, DEFAULT_PAGE_ROTATION, headerConfigShape, metagameScopeShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/**
 * The Archetype Spotlight Screen Mode's config contract (#761): one Archetype's
 * pilots, meta share, Conversion Rate and most-included cards within a
 * Metagame Scope. It carries the shared Metagame Scope, and its conversion
 * target uses the Metagame mode's vocabulary and bounds, so the Screen asks the
 * archetype detail read what the app's archetype page asks it.
 *
 * Its Page Rotation pages the pilots; the numbers and cards stay on every page.
 */
export const archetypeSpotlightModeConfigContract = defineScreenModeConfigContract({
	/** The spotlit Archetype; an Event Reference (ADR-0038). */
	archetypeId: z.number().int().positive().optional(),

	// Scoping
	...metagameScopeShape,

	// Conversion Rate target: a numerator condition inside the scope, never narrowing it.
	conversionMetric: editorField(z.enum(METAGAME_CONVERSION_METRIC_VALUES), { label: 'Conversion target' }),
	conversionThreshold: editorField(z.number().int().min(1).max(999), { label: 'Conversion threshold' }),

	// Top included cards
	board: editorField(z.enum(BOARD_SELECTION_VALUES), { label: 'Board' }),
	cardLimit: editorField(z.number().int().min(1).max(20), { label: 'Top cards' }),
	excludedCardTypes: z.array(z.enum(CARD_TYPE_BUCKET_ORDER)).max(CARD_TYPE_BUCKET_ORDER.length),

	// Header
	...headerConfigShape,

	// Pagination: pilots per page
	rowsPerPage: pageRotationPageSize,
	...pageRotationShape,
}, {
	archetypeId: undefined,
	...DEFAULT_METAGAME_SCOPE,
	conversionMetric: 'topN',
	conversionThreshold: 8,
	board: 'full',
	cardLimit: 8,
	// Nonbasic lands read as noise among an Archetype's signature cards, as on Most Played Cards.
	excludedCardTypes: ['Land'],
	...DEFAULT_HEADER_CONFIG,
	rowsPerPage: 8,
	...DEFAULT_PAGE_ROTATION,
});

export type ArchetypeSpotlightModeConfig = ScreenModeConfigOf<typeof archetypeSpotlightModeConfigContract>;
