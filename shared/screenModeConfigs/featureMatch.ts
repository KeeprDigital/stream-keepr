import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { PLAYER_SIDE_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';

/** The Feature Match control Screen Mode's config contract: its shape, type, and defaults. */
export const featureMatchModeConfigContract = defineScreenModeConfigContract({
	featureMatchId: z.number().int().positive().nullable(),
	showNames: z.boolean(),
	showRecords: z.boolean(),
	showDeckNames: z.boolean(),
	showPronouns: z.boolean(),
	showClock: z.boolean(),
	showCounters: z.boolean(),
	showSeatLabels: z.boolean().optional(),
	// Layout: which player data slot renders on the left side of the screen
	leftSidePlayer: z.enum(PLAYER_SIDE_VALUES).optional(),
	// Turn controls: show the turn/active-player widget
	showTurnControls: z.boolean().optional(),
	// Overtime: show the extra turns tracker when overtime begins
	showOvertime: z.boolean().optional(),
	// Mulligan info: show the cards kept indicator
	showMulliganInfo: z.boolean().optional(),
	// LGS: show the player's Local Game Store
	showLgs: z.boolean().optional(),
	// Table number: show the feature match table number in the header
	showTableNumber: z.boolean().optional(),
	// Control permissions: what players can do from the control screen
	allowLifeControls: z.boolean().optional(),
	allowGameWinControls: z.boolean().optional(),
	allowCounterControls: z.boolean().optional(),
}, {
	featureMatchId: null,
	showNames: true,
	showRecords: true,
	showDeckNames: true,
	showPronouns: true,
	showClock: true,
	showCounters: true,
	showSeatLabels: true,
	showTurnControls: true,
	showOvertime: true,
	showMulliganInfo: true,
	showLgs: true,
	showTableNumber: true,
	leftSidePlayer: 'player1',
	allowLifeControls: true,
	allowGameWinControls: true,
	allowCounterControls: true,
});

export type FeatureMatchModeConfig = ScreenModeConfigOf<typeof featureMatchModeConfigContract>;
