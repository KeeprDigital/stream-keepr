import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { PLAYER_HISTORY_COLUMN_KEY_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationShape } from './subShapes';

/** The Player History Screen Mode's config contract: its shape, type, and defaults. */
export const playerHistoryModeConfigContract = defineScreenModeConfigContract({
	playerId: z.number().int().positive().nullable(),
	columns: z.array(columnConfigSchema(PLAYER_HISTORY_COLUMN_KEY_VALUES)).min(1).max(6),
	...headerConfigShape,
	rowsPerPage: z.number().int().min(1).max(100),
	...pageRotationShape,
}, {
	playerId: null,
	columns: [
		{ key: 'round', visible: true },
		{ key: 'opponent', visible: true },
		{ key: 'table', visible: true },
		{ key: 'outcome', visible: true },
	],
	...DEFAULT_HEADER_CONFIG,
	rowsPerPage: 8,
	...DEFAULT_PAGE_ROTATION,
});

export type PlayerHistoryModeConfig = ScreenModeConfigOf<typeof playerHistoryModeConfigContract>;
export type PlayerHistoryColumnConfig = PlayerHistoryModeConfig['columns'][number];
