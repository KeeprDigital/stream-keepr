import { eventService } from '~~/server/services/event';
import { requireScreenOutputRead, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';
import { toScreenOutputEvent } from '~~/shared/utils/screenOutputEvent';

/**
 * The Event context a Screen Output renders with (#604).
 *
 * The ordinary Event read stays private (ADR-0010); this answers only the
 * allowlisted fields, so integration credentials, sync diagnostics and
 * operator notes never reach a machine holding a capability.
 */
export default defineEventHandler(async (event) => {
	const { eventId } = await requireScreenOutputRead(event);
	const found = await eventService().findById(eventId);
	if (!found)
		screenOutputReadNotFound();

	return toScreenOutputEvent(found);
});
