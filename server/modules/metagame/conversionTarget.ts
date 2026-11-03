import type { ConversionTarget } from '~~/shared/conversionTarget';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events } from '~~/server/db/schema';
import { DEFAULT_CONVERSION_TARGET } from '~~/shared/conversionTarget';

/** The Event's Conversion Target, which a Screen Output's Metagame read counts against (ADR-0061). */
export async function readEventConversionTarget(eventId: number): Promise<ConversionTarget> {
	const event = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		columns: { conversionMetric: true, conversionThreshold: true },
	});
	return event ?? DEFAULT_CONVERSION_TARGET;
}
