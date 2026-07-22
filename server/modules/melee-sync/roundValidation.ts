import type { DbRound } from '~~/server/db/schema';
import { createError } from 'h3';
import { roundService } from '~~/server/services/round';
import { isMeleeManagedRound } from '~~/shared/utils/roundControl';

/**
 * Resolve a Round inside the requested Event and assert that it is eligible for
 * Melee-managed Match replacement.
 *
 * Command handlers call this before any prerequisite writes, while the deep
 * Round workflow calls it again at the write boundary to defend against stale
 * or non-command callers.
 */
export async function requireMeleeManagedRound(eventId: number, roundId: number): Promise<DbRound> {
	const round = await roundService().findById(roundId, eventId);

	if (!round) {
		throw createError({
			statusCode: 404,
			message: 'Round not found',
		});
	}

	if (!isMeleeManagedRound(round)) {
		throw createError({
			statusCode: 400,
			message: 'Round is not eligible for Melee sync',
		});
	}

	return round;
}
