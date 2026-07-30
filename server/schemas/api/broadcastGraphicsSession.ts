import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsSession';
import { z } from 'zod';
import { BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES } from '~~/shared/modules/broadcast-graphics-session';

export const broadcastGraphicsScreenParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	screenId: z.coerce.number().int().positive(),
});

export const broadcastGraphicsSessionParamsSchema = broadcastGraphicsScreenParamsSchema.extend({
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

export type BroadcastGraphicsScreenParams = z.infer<typeof broadcastGraphicsScreenParamsSchema>;
export type BroadcastGraphicsSessionParams = z.infer<typeof broadcastGraphicsSessionParamsSchema>;
