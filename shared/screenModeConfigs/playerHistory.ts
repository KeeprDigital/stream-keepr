import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { PLAYER_HISTORY_COLUMN_KEY_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';

const playerHistoryColumnConfigSchema = z.object({
	key: z.enum(PLAYER_HISTORY_COLUMN_KEY_VALUES),
	visible: z.boolean(),
}).strict();

/** The Player History Screen Mode's config contract: its shape, type, and defaults. */
export const playerHistoryModeConfigContract = defineScreenModeConfigContract({
	playerId: z.number().int().positive().nullable(),
	columns: z.array(playerHistoryColumnConfigSchema).min(1).max(6),
	showHeader: z.boolean(),
	headerText: z.string().max(200).optional(),
	rowsPerPage: z.number().int().min(1).max(100),
	autoPageEnabled: z.boolean(),
	autoPageIntervalMs: z.number().int().min(3000).max(60000),
	currentPage: z.number().int().min(1).optional(),
	rotationAnchor: z.number().int().nonnegative().optional(),
}, {
	playerId: null,
	columns: [
		{ key: 'round', visible: true },
		{ key: 'opponent', visible: true },
		{ key: 'table', visible: true },
		{ key: 'outcome', visible: true },
	],
	showHeader: true,
	headerText: undefined,
	rowsPerPage: 8,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
});

export type PlayerHistoryModeConfig = ScreenModeConfigOf<typeof playerHistoryModeConfigContract>;
export type PlayerHistoryColumnConfig = PlayerHistoryModeConfig['columns'][number];
