import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { PLAYER_HISTORY_COLUMN_KEY_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField, withEditorMeta } from './fields';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/** The Player History Screen Mode's config contract: its shape, type, and defaults. */
export const playerHistoryModeConfigContract = defineScreenModeConfigContract({
	playerId: editorField(z.number().int().positive().nullable(), {
		label: 'Player',
		card: 'source',
		reference: 'player',
		description: 'The Player whose Match history shows.',
	}),
	columns: editorField(z.array(columnConfigSchema(PLAYER_HISTORY_COLUMN_KEY_VALUES)).min(1).max(PLAYER_HISTORY_COLUMN_KEY_VALUES.length), {
		label: 'Columns',
		card: 'content',
		group: 'table',
		slot: 'columns',
		description: 'Drag to reorder, toggle to show or hide.',
		options: {
			round: 'Round',
			opponent: 'Opponent',
			table: 'Table',
			outcome: 'Outcome',
			opponentArchetype: 'Opponent archetype',
			gameScore: 'Game score',
		},
	}),
	...headerConfigShape({
		shows: 'Show the Player\'s name and record above their Match history.',
		auto: 'Empty shows the Player\'s name and "Match History".',
	}),
	rowsPerPage: withEditorMeta(pageRotationPageSize, { description: 'Matches on each page.' }),
	...pageRotationShape,
}, {
	playerId: null,
	columns: [
		{ key: 'round', visible: true },
		{ key: 'opponent', visible: true },
		{ key: 'table', visible: true },
		{ key: 'outcome', visible: true },
		{ key: 'opponentArchetype', visible: false },
		{ key: 'gameScore', visible: false },
	],
	...DEFAULT_HEADER_CONFIG,
	rowsPerPage: 8,
	...DEFAULT_PAGE_ROTATION,
}, {
	groups: {
		'table': { title: 'Table', card: 'content' },
		'outcome-badge': { title: 'Outcome badge', card: 'content' },
	},
});

export type PlayerHistoryModeConfig = ScreenModeConfigOf<typeof playerHistoryModeConfigContract>;
export type PlayerHistoryColumnConfig = PlayerHistoryModeConfig['columns'][number];
