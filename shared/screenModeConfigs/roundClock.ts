import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { COUNT_UP_LIMIT_MINUTES_MAX, COUNT_UP_LIMIT_MINUTES_MIN } from '../utils/clock';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';

/**
 * The Round Clock Screen Mode's config contract: its shape, type, and defaults.
 *
 * With no Round picked it shows the Current Round, so it follows the Event
 * from Round to Round without an operator (ADR-0066).
 */
export const roundClockModeConfigContract = defineScreenModeConfigContract({
	/** The Round whose clock is shown; an Event Reference (ADR-0038). Unset shows the Current Round. */
	roundId: editorField(z.number().int().positive().optional(), {
		label: 'Round',
		card: 'source',
		reference: 'round',
		placeholder: 'Current Round',
		description: 'The Current Round follows the Event as Melee pairs each Round; set a Round\'s start and duration on the Event Structure page.',
	}),
	showRoundName: editorField(z.boolean(), {
		label: 'Show Round name',
		card: 'content',
		group: 'round-name',
		description: 'Show the Round\'s name above its clock.',
	}),
	countUpAfterEnd: editorField(z.boolean(), {
		label: 'Count up after the end',
		card: 'content',
		group: 'clock',
		description: 'When the Round ends, count up the time since the end instead of holding 0:00.',
	}),
	/** Minutes the clock counts up to after the end, then holds; unset counts up without limit. */
	countUpLimitMinutes: editorField(
		z.number().int().min(COUNT_UP_LIMIT_MINUTES_MIN).max(COUNT_UP_LIMIT_MINUTES_MAX).optional(),
		{
			label: 'Count-up limit (minutes)',
			card: 'content',
			group: 'clock',
			placeholder: 'No limit',
			description: 'Stop counting up after this many minutes and hold.',
			showWhen: ({ config }) => config.countUpAfterEnd === true,
		},
	),
}, {
	roundId: undefined,
	showRoundName: true,
	countUpAfterEnd: false,
	countUpLimitMinutes: undefined,
}, {
	groups: {
		'round-name': { title: 'Round name', card: 'content' },
		'clock': { title: 'Clock', card: 'content' },
	},
});

export type RoundClockModeConfig = ScreenModeConfigOf<typeof roundClockModeConfigContract>;
