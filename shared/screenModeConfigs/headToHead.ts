import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { HEAD_TO_HEAD_PLAYER_SOURCE_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, headerConfigShape } from './subShapes';

const entityId = z.number().int().positive().nullable();

/**
 * The Head-to-head Screen Mode's config contract: its shape, type, and defaults
 * (#760).
 *
 * `playerSource` chooses where its two Players come from: the Feature Match
 * Slot `featureMatchId`, following that Slot's current Feature Match
 * Assignment, or the Players `player1Id` and `player2Id` picked directly. The
 * choice not taken is kept, so switching back restores it. Each id is an Event
 * Reference (ADR-0038).
 */
export const headToHeadModeConfigContract = defineScreenModeConfigContract({
	playerSource: editorField(z.enum(HEAD_TO_HEAD_PLAYER_SOURCE_VALUES), { label: 'Players from' }),
	featureMatchId: entityId,
	player1Id: entityId,
	player2Id: entityId,
	...headerConfigShape,
}, {
	playerSource: 'featureMatchSlot',
	featureMatchId: null,
	player1Id: null,
	player2Id: null,
	...DEFAULT_HEADER_CONFIG,
});

export type HeadToHeadModeConfig = ScreenModeConfigOf<typeof headToHeadModeConfigContract>;
