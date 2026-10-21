import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { PLAYER_SIDE_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';

/** The Feature Match control Screen Mode's config contract: its shape, type, and defaults. */
export const featureMatchModeConfigContract = defineScreenModeConfigContract({
	featureMatchId: z.number().int().positive().nullable(),
	showNames: z.boolean(),
	showRecords: editorField(z.boolean(), { label: 'Show Player Record' }),
	/** Labelled for Magic; the editor names the game's own player identity in place of "Deck". */
	showDeckNames: editorField(z.boolean(), { label: 'Show Deck Names' }),
	showPronouns: editorField(z.boolean(), { label: 'Show Pronouns' }),
	showClock: editorField(z.boolean(), { label: 'Show Clock' }),
	showCounters: editorField(z.boolean(), { label: 'Show Counters' }),
	showSeatLabels: editorField(z.boolean().optional(), { label: 'Show Seat Labels' }),
	// Layout: which player data slot renders on the left side of the screen
	leftSidePlayer: editorField(z.enum(PLAYER_SIDE_VALUES).optional(), { label: 'Left Side of Screen' }),
	// Turn controls: show the turn/active-player widget
	showTurnControls: editorField(z.boolean().optional(), { label: 'Show Turn Controls' }),
	// Overtime: show the extra turns tracker when overtime begins
	showOvertime: editorField(z.boolean().optional(), { label: 'Show Overtime' }),
	// Mulligan info: show the cards kept indicator
	showMulliganInfo: editorField(z.boolean().optional(), { label: 'Show Mulligan Info' }),
	// LGS: show the player's Local Game Store
	showLgs: editorField(z.boolean().optional(), { label: 'Show LGS' }),
	// Table number: show the feature match table number in the header
	showTableNumber: editorField(z.boolean().optional(), { label: 'Show Table Number' }),
	// Control permissions: what players can do from the control screen
	allowLifeControls: editorField(z.boolean().optional(), { label: 'Life Total Controls' }),
	allowGameWinControls: editorField(z.boolean().optional(), { label: 'Game Win Controls' }),
	allowCounterControls: editorField(z.boolean().optional(), { label: 'Counter Controls' }),
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
