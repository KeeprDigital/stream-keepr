import type { ScreenOutputEvent } from '~~/shared/utils/screenOutputEvent';
import { mapThemeToScreenOutput } from '~~/server/mappers/theme';
import { eventService } from '~~/server/services/event';
import { themeService } from '~~/server/services/theme';
import { requireScreenOutputRead, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';
import { toScreenOutputEvent } from '~~/shared/utils/screenOutputEvent';

/**
 * The Event context a Screen Output renders with (#604).
 *
 * The ordinary Event read stays private (ADR-0010); this answers only the
 * allowlisted fields, so integration credentials, sync diagnostics and
 * operator notes never reach a machine holding a capability.
 *
 * It carries the Event's Theme too, the stored values every Screen of the
 * Event resolves its tokens from, so Reconnect Resync re-reads it with the rest
 * of the context (ADR-0049).
 */
export default defineEventHandler(async (event): Promise<ScreenOutputEvent> => {
	const { eventId } = await requireScreenOutputRead(event);
	const found = await eventService().findById(eventId);
	if (!found)
		screenOutputReadNotFound();

	const theme = found.themeId
		? await themeService().findById(found.themeId)
		: undefined;
	return {
		...toScreenOutputEvent(found),
		theme: theme
			? mapThemeToScreenOutput(theme)
			: null,
	};
});
