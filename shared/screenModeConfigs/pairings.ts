import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { defineScreenModeConfigContract } from './contract';
import { DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/** The Pairings Screen Mode's config contract: its shape, type, and defaults. */
export const pairingsModeConfigContract = defineScreenModeConfigContract({
	/** The Round whose Matches are shown; an Event Reference (ADR-0038). */
	roundId: z.number().int().positive().optional(),
	...headerConfigShape,
	rowsPerPage: pageRotationPageSize,
	...pageRotationShape,
}, {
	roundId: undefined,
	...DEFAULT_HEADER_CONFIG,
	rowsPerPage: 10,
	...DEFAULT_PAGE_ROTATION,
});

export type PairingsModeConfig = ScreenModeConfigOf<typeof pairingsModeConfigContract>;
