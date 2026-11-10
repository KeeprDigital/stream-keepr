import { z } from 'zod';
import { screenOutputAssetCapabilityManagerForEvent } from '~~/server/modules/screen-output-assets/runtime';
import { TemporarilyUnavailableError } from '~~/server/utils/errors';
import { screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

const bodySchema = z.object({
	link: z.string(),
}).strict();

/**
 * Exchange a Screen Output Link for its Screen's Screen Output Asset Capability.
 *
 * The link is the only credential: it names its Screen, so no Session arm
 * exists and a Session the request happens to carry is never read. It travels
 * in the body, so the exchange puts it in no URL.
 *
 * Every refusal is the Screen Output surface's one 404, an unreadable body
 * included, so nothing says which part of a presented value was wrong. A
 * storage failure is a retryable 503 and never that 404: an output renders
 * nothing on a confirmed 404 and retries a 5xx.
 */
export default defineEventHandler(async (event) => {
	const body = bodySchema.safeParse(await readBody<unknown>(event).catch(() => undefined));
	if (!body.success)
		screenOutputReadNotFound();

	const manager = screenOutputAssetCapabilityManagerForEvent(event);
	let exchanged: Awaited<ReturnType<typeof manager.exchange>>;
	try {
		exchanged = await manager.exchange({ link: body.data.link });
	}
	catch (failure) {
		setResponseHeader(event, 'retry-after', 5);
		// The cause carries this sentence past the 5xx sanitizer; the store's own
		// failure rides inside it, for the log and not for the caller.
		const cause = new TemporarilyUnavailableError(
			'Screen Output Link exchange is temporarily unavailable',
			{ cause: failure },
		);
		throw createError({
			statusCode: cause.statusCode,
			statusMessage: 'Service Unavailable',
			message: cause.message,
			cause,
		});
	}
	if (exchanged.outcome === 'missing')
		screenOutputReadNotFound();

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return {
		eventId: exchanged.eventId,
		screenId: exchanged.screenId,
		assetCapability: exchanged.capability,
	};
});
