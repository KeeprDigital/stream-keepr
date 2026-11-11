import type { ScreenModeConfigOf } from './contract';
import type { ScreenSettingsContext } from './fields';
import { z } from 'zod';
import { HEAD_TO_HEAD_PLAYER_SOURCE_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, headerConfigShape } from './subShapes';

const entityId = z.number().int().positive().nullable();

/** Whether the two Players come from a Feature Match Slot, or are picked directly. */
const followsSlot = ({ config }: ScreenSettingsContext) => config.playerSource === 'featureMatchSlot';

/**
 * The Head-to-Head Screen Mode's config contract: its shape, type, and defaults
 * (#760).
 *
 * `playerSource` chooses where its two Players come from: the Feature Match
 * Slot `featureMatchId`, following that Slot's current Feature Match
 * Assignment, or the Players `player1Id` and `player2Id` picked directly. The
 * choice not taken is kept, so switching back restores it. Each id is an Event
 * Reference (ADR-0038).
 *
 * `showPronouns` and `showDeckColors` show each Player's pronouns and their
 * Archetype's mana-colour pips; both default on, as they always showed (#903).
 */
export const headToHeadModeConfigContract = defineScreenModeConfigContract({
	playerSource: editorField(z.enum(HEAD_TO_HEAD_PLAYER_SOURCE_VALUES), {
		label: 'Players from',
		card: 'source',
		description: 'Follow a Feature Match Slot as it is reassigned, or pick the two Players.',
		options: { featureMatchSlot: 'A Feature Match Slot', players: 'Two Players' },
	}),
	featureMatchId: editorField(entityId, {
		label: 'Feature Match Slot',
		card: 'source',
		reference: 'featureMatchSlot',
		description: 'Shows the two Players of the Match this Slot is showing.',
		showWhen: followsSlot,
	}),
	player1Id: editorField(entityId, {
		label: 'First Player',
		card: 'source',
		reference: 'player',
		showWhen: context => !followsSlot(context),
	}),
	player2Id: editorField(entityId, {
		label: 'Second Player',
		card: 'source',
		reference: 'player',
		showWhen: context => !followsSlot(context),
	}),
	showPronouns: editorField(z.boolean(), {
		label: 'Show pronouns',
		card: 'content',
		group: 'player-details',
		description: 'Show each Player\'s pronouns below their name.',
		showWhen: ({ event }) => event?.pronounsEnabled ?? true,
	}),
	showDeckColors: editorField(z.boolean(), {
		label: 'Show deck colours',
		card: 'content',
		group: 'player-details',
		description: 'Show the mana colours of each Player\'s deck beside its name.',
	}),
	...headerConfigShape({
		shows: 'Show a title above the two Players.',
		auto: 'Empty shows "Head to Head".',
	}),
}, {
	playerSource: 'featureMatchSlot',
	featureMatchId: null,
	player1Id: null,
	player2Id: null,
	showPronouns: true,
	showDeckColors: true,
	...DEFAULT_HEADER_CONFIG,
}, {
	groups: {
		'player-details': { title: 'Player details', card: 'content' },
	},
});

export type HeadToHeadModeConfig = ScreenModeConfigOf<typeof headToHeadModeConfigContract>;
