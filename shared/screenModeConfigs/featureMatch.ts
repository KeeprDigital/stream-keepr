import type { ScreenModeConfigOf } from './contract';
import type { ScreenSettingsContext } from './fields';
import { z } from 'zod';
import { getCounterTypeConfigs, getFeatureMatchStateTracking, getPlayerIdentityLabel } from '../config/games';
import { PLAYER_SIDE_VALUES } from '../types/enums';
import { toFeatureMatchDefaults } from '../types/featureMatchDefaults';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';

/** What the Event's Card Game tracks, which bounds what its own toggles can turn on; all of it until the Event loads. */
function tracks({ event }: ScreenSettingsContext) {
	return event?.game
		? getFeatureMatchStateTracking(event.game)
		: null;
}

/** Whether the Event's Card Game has counters. */
function hasCounterTypes({ event }: ScreenSettingsContext): boolean {
	return event?.game
		? getCounterTypeConfigs(event.game).length > 0
		: false;
}

/** Whether the Event's Match orientation seats its players top and bottom. */
function isVertical({ event }: ScreenSettingsContext): boolean {
	return event?.featureMatchOrientation === 'vertical';
}

/** A toggle of one of the Screen's groups: player info, match display, game state or control permissions. */
function toggle(group: string, label: string, description: string, showWhen?: (context: ScreenSettingsContext) => boolean) {
	return {
		label,
		card: 'content',
		group,
		description,
		showWhen,
	} as const;
}

/**
 * The Feature Match control Screen Mode's config contract: its shape, type, and
 * defaults. A toggle the Event or its Card Game cannot use is hidden (#1060).
 */
export const featureMatchModeConfigContract = defineScreenModeConfigContract({
	featureMatchId: editorField(z.number().int().positive().nullable(), {
		label: 'Feature Match Slot',
		card: 'source',
		reference: 'featureMatchSlot',
		description: 'The Slot whose Match this Screen controls.',
	}),
	showNames: editorField(z.boolean(), toggle('player-info', 'Show names', 'Show each player\'s name.')),
	showRecords: editorField(z.boolean(), toggle(
		'player-info',
		'Show record',
		'Show the player record or position next to their name.',
		({ event }) => event?.standingsEnabled ?? true,
	)),
	/** Labelled for Magic; each Card Game names its own player identity in place of "deck". */
	showDeckNames: editorField(z.boolean(), {
		...toggle('player-info', 'Show deck names', 'Show each player\'s deck name below their name.'),
		labelFor: ({ event }) => event?.game
			? `Show ${getPlayerIdentityLabel(event.game).toLowerCase()} names`
			: 'Show deck names',
	}),
	showPronouns: editorField(z.boolean(), toggle(
		'player-info',
		'Show pronouns',
		'Show player pronouns next to their name.',
		({ event }) => event?.pronounsEnabled ?? true,
	)),
	showClock: editorField(z.boolean(), toggle('match-display', 'Show clock', 'Show the match clock.')),
	showCounters: editorField(z.boolean(), toggle(
		'game-state',
		'Show counters',
		'Show player counters, such as poison and energy.',
		hasCounterTypes,
	)),
	showSeatLabels: editorField(z.boolean().optional(), {
		...toggle('match-display', 'Show seat labels', 'Show seat labels next to player names.'),
		description: context => `Show ${isVertical(context)
			? 'Top/Bottom'
			: 'Left/Right'} labels next to player names.`,
	}),
	// Layout: which player data slot renders on the left side of the screen
	leftSidePlayer: editorField(z.enum(PLAYER_SIDE_VALUES).optional(), {
		label: 'Left side of Screen',
		card: 'content',
		group: 'match-display',
		description: 'Which player seat appears on the left side of the match screen.',
		options: context => isVertical(context)
			? { player1: 'Top player', player2: 'Bottom player' }
			: { player1: 'Left player', player2: 'Right player' },
	}),
	// Turn controls: show the turn/active-player widget
	showTurnControls: editorField(z.boolean().optional(), toggle(
		'game-state',
		'Show turn controls',
		'Show the turn counter and active player controls.',
		({ event }) => {
			const defaults = toFeatureMatchDefaults(event);
			return defaults.turnTrackingEnabled || defaults.activePlayerTrackingEnabled;
		},
	)),
	// Overtime: show the extra turns tracker when overtime begins
	showOvertime: editorField(z.boolean().optional(), toggle(
		'game-state',
		'Show overtime',
		'Show the extra turns tracker when overtime begins.',
		context => (tracks(context)?.overtime ?? true) && toFeatureMatchDefaults(context.event).extraTurnsEnabled,
	)),
	// Mulligan info: show the cards kept indicator
	showMulliganInfo: editorField(z.boolean().optional(), toggle(
		'game-state',
		'Show mulligan info',
		'Show the cards kept indicator during the mulligan.',
		context => (tracks(context)?.mulligan ?? true) && toFeatureMatchDefaults(context.event).mulliganTrackingEnabled,
	)),
	// LGS: show the player's Local Game Store
	showLgs: editorField(z.boolean().optional(), toggle(
		'player-info',
		'Show LGS',
		'Show the player\'s Local Game Store.',
		({ event }) => event?.lgsEnabled ?? false,
	)),
	// Table number: show the feature match table number in the header
	showTableNumber: editorField(z.boolean().optional(), toggle(
		'match-display',
		'Show table number',
		'Show the match table number in the header.',
		({ event }) => event?.tableNumberEnabled ?? false,
	)),
	// Control permissions: what players can do from the control screen
	allowLifeControls: editorField(z.boolean().optional(), toggle(
		'control-permissions',
		'Life total controls',
		'Allow players to adjust life totals.',
		context => tracks(context)?.life ?? true,
	)),
	allowGameWinControls: editorField(z.boolean().optional(), toggle(
		'control-permissions',
		'Game win controls',
		'Allow players to record and undo game wins.',
	)),
	allowCounterControls: editorField(z.boolean().optional(), toggle(
		'control-permissions',
		'Counter controls',
		'Allow players to add, remove, and adjust counters.',
		hasCounterTypes,
	)),
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
}, {
	groups: {
		'player-info': { title: 'Player info', card: 'content' },
		'match-display': { title: 'Match display', card: 'content' },
		'game-state': { title: 'Game state', card: 'content' },
		'control-permissions': { title: 'Control permissions', card: 'content' },
	},
});

export type FeatureMatchModeConfig = ScreenModeConfigOf<typeof featureMatchModeConfigContract>;
