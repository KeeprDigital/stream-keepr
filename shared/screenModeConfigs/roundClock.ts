import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
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
	roundId: z.number().int().positive().optional(),
	showRoundName: editorField(z.boolean(), { label: 'Show Round name' }),
}, {
	roundId: undefined,
	showRoundName: true,
});

export type RoundClockModeConfig = ScreenModeConfigOf<typeof roundClockModeConfigContract>;
