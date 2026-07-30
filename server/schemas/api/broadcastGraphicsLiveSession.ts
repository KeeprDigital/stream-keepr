import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import { z } from 'zod';
import { BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES } from '~~/shared/modules/broadcast-graphics-live-session';
import { screenParamsSchema } from './screen';

/** A playout route names the epoch as well as the Screen that owns it. */
export const broadcastGraphicsLiveSessionParamsSchema = screenParamsSchema.extend({
	sessionId: z.coerce.number().int().positive(),
});

/**
 * One playout action. Cut is a modifier on the action rather than an action of
 * its own, and there is no base sequence: a target-state intent stays valid
 * however far the session has advanced.
 */
export const broadcastGraphicsCommandSchema = z.object({
	commandId: z.string().min(1).max(100),
	type: z.enum(BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES),
	payload: z.object({
		graphicId: z.string().min(1).max(100),
		cut: z.boolean().optional(),
	}).strict(),
}).strict() satisfies z.ZodType<BroadcastGraphicsCommand>;

export type BroadcastGraphicsLiveSessionParams = z.infer<typeof broadcastGraphicsLiveSessionParamsSchema>;
