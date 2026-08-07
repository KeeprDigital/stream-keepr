import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REALTIME_MESSAGE_BYTES } from '~~/shared/types/messages';
import { lastCallTo } from '~~/test/helpers/lastCallTo';
import { ErrorInfoShaped } from '~~/test/helpers/providerRefusal';

/**
 * The failure line, told apart from the other line this module writes.
 *
 * `console.error` is a shared subject: `ably.ts` logs `realtime_publish_oversized`
 * from the size diagnostic as well as `realtime_publish_failed` from the catch, and
 * both reach the same spy. Selecting by the line's own `message` means these tests
 * read the failure they arranged even when another line lands beside it (#280).
 */
function isPublishFailureLine(call: unknown[]): boolean {
	const [line] = call;
	return typeof line === 'string' && line.includes('"message":"realtime_publish_failed"');
}

/** The failure line as it was written, for assertions about the text itself. */
function loggedLine(spy: ReturnType<typeof vi.spyOn>): string {
	const [line] = lastCallTo(spy, isPublishFailureLine);
	return line as string;
}

function loggedFields(spy: ReturnType<typeof vi.spyOn>) {
	return JSON.parse(loggedLine(spy));
}

const mockPublish = vi.fn();
const mockGetChannel = vi.fn(() => ({ publish: mockPublish }));

class MockAblyRest {
	channels = { get: mockGetChannel };
	static callCount = 0;
	static lastKey: string | undefined;
	constructor(key: string) {
		MockAblyRest.callCount++;
		MockAblyRest.lastKey = key;
	}

	static reset() {
		MockAblyRest.callCount = 0;
		MockAblyRest.lastKey = undefined;
	}
}

vi.mock('ably', () => ({
	default: { Rest: MockAblyRest },
}));

vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ ablyApiKey: 'test-key' })));
vi.stubGlobal('getHeader', vi.fn());

// ──────────────── getOriginConnectionId ────────────────

describe('getOriginConnectionId', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.mocked(getHeader).mockReset();
	});

	it('extracts x-realtime-connection-id header', async () => {
		vi.mocked(getHeader).mockReturnValue('conn-abc-123');
		const { getOriginConnectionId } = await import('~~/server/utils/ably');
		const mockEvent = {} as any;
		expect(getOriginConnectionId(mockEvent)).toBe('conn-abc-123');
		expect(getHeader).toHaveBeenCalledWith(mockEvent, 'x-realtime-connection-id');
	});
});

// ──────────────── getAblyClient ────────────────

describe('getAblyClient', () => {
	beforeEach(() => {
		vi.resetModules();
		MockAblyRest.reset();
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('returns Ably.Rest instance when configured', async () => {
		const { getAblyClient } = await import('~~/server/utils/ably');
		const client = getAblyClient();
		expect(MockAblyRest.lastKey).toBe('test-key');
		expect(client).toBeDefined();
		expect(client.channels).toBeDefined();
	});

	it('returns same instance on subsequent calls', async () => {
		const { getAblyClient } = await import('~~/server/utils/ably');
		const client1 = getAblyClient();
		const client2 = getAblyClient();
		expect(client1).toBe(client2);
		expect(MockAblyRest.callCount).toBe(1);
	});
});

// ──────────────── publishMessage ────────────────

describe('publishMessage', () => {
	beforeEach(() => {
		vi.resetModules();
		MockAblyRest.reset();
		mockGetChannel.mockClear();
		mockPublish.mockClear();
		mockPublish.mockResolvedValue(undefined);
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('calls channel.publish with correct message type', async () => {
		const { publishMessage } = await import('~~/server/utils/ably');
		await publishMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123');
		expect(mockGetChannel).toHaveBeenCalledWith('event:1');
		expect(mockPublish).toHaveBeenCalledWith(
			'event:deleted',
			expect.objectContaining({ eventId: 1, originConnectionId: 'conn-123' }),
		);
	});

	it('does not turn missing realtime configuration into a command failure', async () => {
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: '' } as any);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await expect(
			publishMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123'),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledOnce();
		expect(mockPublish).not.toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it('preserves missing realtime configuration failures for strict publications', async () => {
		// The strict path's contract is that the caller hears about it. What it hears
		// is #267's classification: the setting's own name, so a Melee sync that could
		// not announce itself says which environment variable to go and set.
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: '' } as any);
		const { publishMessageStrict } = await import('~~/server/utils/ably');
		const { ServiceConfigurationError } = await import('~~/server/utils/errors');

		const failure = await publishMessageStrict(1, 'melee:playersSynced', { playerCount: 2 }, 'conn-123')
			.then(() => null, error => error);

		expect(failure).toBeInstanceOf(ServiceConfigurationError);
		expect(failure.message).toBe('NUXT_ABLY_API_KEY is not configured');
		expect(failure.statusCode).toBe(503);
	});
});

// ──────────────── the failed-publish diagnosis ────────────────

/**
 * What the log says when the provider refuses a publish (#253).
 *
 * `publishMessage` log-and-swallows by design — the Screen command route's 200
 * depends on nothing local (#242 item 3) — so the log line is the only witness a
 * publish failed. It used to name the event and the message type and stop there,
 * which is silence in the case that matters: under a rejected key every Screen
 * mutation spends an outbound request and the log never says the key was why.
 *
 * These pin the enriched fields, the fallbacks for throws that are not the
 * provider's, that nothing outside the named fields reaches the log, and — the
 * part a future edit could quietly take away — that the swallow still swallows.
 */
describe('failed realtime publishes', () => {
	beforeEach(() => {
		vi.resetModules();
		MockAblyRest.reset();
		mockGetChannel.mockClear();
		mockPublish.mockClear();
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('names the provider status and code a rejected key fails with', async () => {
		// The 40400/404 shape #242 diagnosed client-side; the server had it all along.
		mockPublish.mockRejectedValue(new ErrorInfoShaped('No application found', 40400, 404));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toEqual({
			message: 'realtime_publish_failed',
			eventId: 7,
			messageType: 'event:deleted',
			statusCode: 404,
			errorCode: 40400,
			errorName: 'Error',
			reason: 'No application found',
		});
		errorSpy.mockRestore();
	});

	it('still swallows the failure, because the route has no local effect to report', async () => {
		mockPublish.mockRejectedValue(new ErrorInfoShaped('No application found', 40400, 404));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await expect(
			publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123'),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledOnce();
		errorSpy.mockRestore();
	});

	it('leaves the strict path free to propagate the same rejection', async () => {
		mockPublish.mockRejectedValue(new ErrorInfoShaped('No application found', 40400, 404));
		const { publishMessageStrict } = await import('~~/server/utils/ably');

		await expect(
			publishMessageStrict(7, 'melee:playersSynced', { playerCount: 2 }, 'conn-123'),
		).rejects.toThrow('No application found');
	});

	it('falls back to nulls and the error name when the throw is not the provider’s', async () => {
		mockPublish.mockRejectedValue(new TypeError('channel.publish is not a function'));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toEqual({
			message: 'realtime_publish_failed',
			eventId: 7,
			messageType: 'event:deleted',
			statusCode: null,
			errorCode: null,
			errorName: 'TypeError',
			reason: 'channel.publish is not a function',
		});
		errorSpy.mockRestore();
	});

	it('says the key was missing rather than only that a publish failed', async () => {
		// getAblyClient throws inside the same try, so the commonest deployment
		// failure of all arrives with its reason attached. Since #267 the reason
		// names the setting and `errorName` names the classification, which is what
		// tells this line apart from a provider refusal at a glance — the swallowing
		// path logs both under the same `realtime_publish_failed` message.
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: '' } as any);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toMatchObject({
			errorName: 'ServiceConfigurationError',
			reason: 'NUXT_ABLY_API_KEY is not configured',
		});
		errorSpy.mockRestore();
	});

	it('reports a non-numeric provider code as absent rather than as NaN', async () => {
		// The SDK builds `Number(headers['x-ably-errorcode'])` for a response that
		// carries no Ably error body, so NaN is a shape that actually reaches here.
		const uncoded = new ErrorInfoShaped('Error response received from server', Number.NaN, 502);
		mockPublish.mockRejectedValue(uncoded);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toMatchObject({ statusCode: 502, errorCode: null });
		errorSpy.mockRestore();
	});

	it('keeps the numeric diagnosis when the message is not prose', async () => {
		// Losing the reason must not cost the status too: the fields are read
		// independently, so a malformed message leaves 404/40400 legible.
		const arrayMessage = new ErrorInfoShaped('', 40400, 404);
		Object.defineProperty(arrayMessage, 'message', { value: ['No application found'] });
		mockPublish.mockRejectedValue(arrayMessage);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toMatchObject({
			statusCode: 404,
			errorCode: 40400,
			reason: null,
		});
		errorSpy.mockRestore();
	});

	it('bounds the reason, because the transport puts whole response bodies in it', async () => {
		mockPublish.mockRejectedValue(new Error(`No application found ${'x'.repeat(5000)}`));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');
		const { MAX_PUBLISH_FAILURE_REASON_CHARS } = await import('~~/server/utils/realtimePublishFailure');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		const { reason } = loggedFields(errorSpy);
		expect(reason).toHaveLength(MAX_PUBLISH_FAILURE_REASON_CHARS);
		expect(reason.startsWith('No application found')).toBe(true);
		errorSpy.mockRestore();
	});

	it('keeps the provider’s request metadata out of the log', async () => {
		// The fields are chosen, not copied: `href`, `detail` and `cause` are the
		// parts of an ErrorInfo that can retain request context, and none is named.
		const withMetadata = new ErrorInfoShaped('No application found', 40400, 404);
		withMetadata.href = 'https://help.ably.io/error/40400';
		withMetadata.detail = { key: 'appId.keyId:secret-that-must-not-be-logged' };
		mockPublish.mockRejectedValue(withMetadata);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		const line = loggedLine(errorSpy);
		expect(line).not.toContain('secret-that-must-not-be-logged');
		expect(line).not.toContain('help.ably.io');
		expect(Object.keys(loggedFields(errorSpy))).toEqual([
			'message',
			'eventId',
			'messageType',
			'statusCode',
			'errorCode',
			'errorName',
			'reason',
		]);
		errorSpy.mockRestore();
	});

	it('reports a throw that is not an Error at all without inventing fields', async () => {
		mockPublish.mockRejectedValue('the provider rejected with a bare string');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toEqual({
			message: 'realtime_publish_failed',
			eventId: 7,
			messageType: 'event:deleted',
			statusCode: null,
			errorCode: null,
			errorName: null,
			reason: null,
		});
		errorSpy.mockRestore();
	});

	it('does not let a hostile error shape turn a swallowed failure into a real one', async () => {
		// The catch block is the last line of defence; if reading the error throws,
		// the swallow becomes a 500 on a route whose write already committed.
		const hostile = new Error('unreadable');
		Object.defineProperty(hostile, 'statusCode', {
			get() {
				throw new Error('property access refused');
			},
		});
		mockPublish.mockRejectedValue(hostile);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await expect(
			publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123'),
		).resolves.toBeUndefined();

		expect(loggedFields(errorSpy)).toMatchObject({
			message: 'realtime_publish_failed',
			eventId: 7,
			statusCode: null,
			errorCode: null,
		});
		errorSpy.mockRestore();
	});
});

// ──────────────── the oversized-message diagnostic ────────────────

/**
 * The diagnostic #95 was premised on.
 *
 * A message larger than the provider accepts is refused on publication, and this
 * API logs `realtime_publish_failed` and carries on — correct for best-effort
 * delivery, and useless for diagnosis, because it never says the size was why.
 * That is how a Screen large enough to break its own notification went unnoticed.
 *
 * These pin that it reports, what it reports, and — the part that matters — that it
 * does *not* refuse: the write it announces has already committed, and the account's
 * real ceiling may be above the documented floor this compares against.
 */
describe('oversized realtime messages', () => {
	function oversizedPayload() {
		// One field over the documented floor, so the assertion is about the threshold
		// rather than about any particular message type's shape.
		return { eventId: 1, reason: 'x'.repeat(MAX_REALTIME_MESSAGE_BYTES) } as never;
	}

	function loggedMessages(spy: ReturnType<typeof vi.spyOn>) {
		return spy.mock.calls.map(([entry]: unknown[]) => JSON.parse(entry as string));
	}

	beforeEach(() => {
		vi.resetModules();
		MockAblyRest.reset();
		mockGetChannel.mockClear();
		mockPublish.mockClear();
		mockPublish.mockResolvedValue(undefined);
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('reports the size and the limit, and still publishes', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(1, 'event:deleted', oversizedPayload(), 'conn-123');

		expect(loggedMessages(errorSpy)).toEqual([{
			message: 'realtime_publish_oversized',
			eventId: 1,
			messageType: 'event:deleted',
			bytes: expect.any(Number),
			limit: MAX_REALTIME_MESSAGE_BYTES,
		}]);
		expect(loggedMessages(errorSpy)[0].bytes).toBeGreaterThan(MAX_REALTIME_MESSAGE_BYTES);
		// Reported, not refused: the write has committed and this is a documented
		// floor rather than this account's confirmed ceiling.
		expect(mockPublish).toHaveBeenCalledOnce();
		errorSpy.mockRestore();
	});

	it('says nothing about a message inside the limit', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123');

		expect(errorSpy).not.toHaveBeenCalled();
		expect(mockPublish).toHaveBeenCalledOnce();
		errorSpy.mockRestore();
	});

	it('reports on the strict publication path too, which is where a sync failure surfaces', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessageStrict } = await import('~~/server/utils/ably');

		await publishMessageStrict(1, 'melee:dataReset', oversizedPayload(), 'conn-123');

		expect(loggedMessages(errorSpy)[0]).toMatchObject({
			message: 'realtime_publish_oversized',
			messageType: 'melee:dataReset',
		});
		expect(mockPublish).toHaveBeenCalledOnce();
		errorSpy.mockRestore();
	});
});

// ──────────────── publishScreenCommand ────────────────

describe('publishScreenCommand', () => {
	beforeEach(() => {
		vi.resetModules();
		MockAblyRest.reset();
		mockGetChannel.mockClear();
		mockPublish.mockClear();
		mockPublish.mockResolvedValue(undefined);
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('publishes screen commands to the screen channel', async () => {
		const { publishScreenCommand } = await import('~~/server/utils/ably');

		await publishScreenCommand(1, 10, 'identify');

		expect(mockGetChannel).toHaveBeenCalledWith('screen:1:10');
		expect(mockPublish).toHaveBeenCalledWith(
			'screen:command:identify',
			expect.objectContaining({
				eventId: 1,
				screenId: 10,
				timestamp: expect.any(Number),
			}),
		);
	});

	/**
	 * That a refused publish leaves here as this server's failure, not as the
	 * provider's status wearing the route's clothes.
	 *
	 * The route's only work is this publish, so whatever comes out of here is the
	 * route's answer — and h3 adopts `statusCode` from anything thrown, so an
	 * unwrapped `ErrorInfo` made a rejected key answer 404, indistinguishable from
	 * the route's own 'Screen not found'. #242 spent a round diagnosing that from
	 * the client side; #264 is the server saying it.
	 */
	describe('when the provider refuses the publish', () => {
		it('propagates a named server-side failure instead of the provider\'s 404', async () => {
			mockPublish.mockRejectedValue(new ErrorInfoShaped('No application found', 40400, 404));
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');
			const { REALTIME_PUBLISH_FAILED_MESSAGE, RealtimePublishError } = await import('~~/server/utils/realtimePublishFailure');

			const failure = await publishScreenCommand(1, 10, 'identify').then(() => null, error => error);

			expect(failure).toBeInstanceOf(RealtimePublishError);
			expect(failure.statusCode).toBe(502);
			expect(failure.message).toBe(REALTIME_PUBLISH_FAILED_MESSAGE);
			errorSpy.mockRestore();
		});

		it('carries the provider\'s numeric code, which is what names the refusal', async () => {
			// The error handler logs a cause's `code`, and 40400 is the answer to
			// "why did this fail" — 'No application found' for a key whose app does
			// not exist. Nothing else in the request log line can say that.
			mockPublish.mockRejectedValue(new ErrorInfoShaped('No application found', 40400, 404));
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');

			const failure = await publishScreenCommand(1, 10, 'identify').then(() => null, error => error);

			expect(failure.code).toBe(40400);
			errorSpy.mockRestore();
		});

		it('keeps the provider\'s own account of it in the log', async () => {
			// The same field set the swallowing path emits (#253), for the same
			// reason: the response is not allowed to carry the provider's text, so
			// this line is the only place 'No application found' is ever said.
			mockPublish.mockRejectedValue(new ErrorInfoShaped('No application found', 40400, 404));
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');

			await publishScreenCommand(1, 10, 'identify').catch(() => {});

			expect(loggedFields(errorSpy)).toEqual({
				message: 'realtime_publish_failed',
				eventId: 1,
				screenId: 10,
				messageType: 'screen:command:identify',
				statusCode: 404,
				errorCode: 40400,
				errorName: 'Error',
				reason: 'No application found',
			});
			errorSpy.mockRestore();
		});

		it('reports an absent provider code rather than inventing one', async () => {
			// A throw that is not the provider's — the SDK's own TypeErrors, or a
			// transport failure — must not acquire a code it never had.
			mockPublish.mockRejectedValue(new TypeError('channel.publish is not a function'));
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');

			const failure = await publishScreenCommand(1, 10, 'identify').then(() => null, error => error);

			expect(failure.code).toBeNull();
			expect(failure.statusCode).toBe(502);
			expect(loggedFields(errorSpy)).toMatchObject({ errorName: 'TypeError', errorCode: null });
			errorSpy.mockRestore();
		});

		it('keeps the throw it wrapped, so nothing about the failure is lost', async () => {
			const refusal = new ErrorInfoShaped('No application found', 40400, 404);
			mockPublish.mockRejectedValue(refusal);
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');

			const failure = await publishScreenCommand(1, 10, 'identify').then(() => null, error => error);

			expect(failure.cause).toBe(refusal);
			errorSpy.mockRestore();
		});
	});

	/**
	 * That a key nobody ever set says so, in the one word the reader can act on.
	 *
	 * `getAblyClient` throws before there is a publish to refuse, and a missing
	 * setting is not the provider refusing anything — classifying it as one would
	 * file an unfinished deployment under 'the realtime service said no'. #267 is
	 * the other half: the throw used to be a plain `Error`, which matches no mapper
	 * branch, so the 5xx sanitizer rewrote it to a bare 'Internal Server Error' and
	 * the only person who could fix it was told nothing.
	 */
	describe('when the key was never configured', () => {
		it('leaves an unconfigured key to say so as a configuration failure', async () => {
			// The classification first: not a publish refusal, and not an SDK
			// TypeError either. `not configured` is the part every wording of this
			// has kept, from the plain Error #264 pinned through #267's named one.
			vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: '' } as any);
			const { publishScreenCommand } = await import('~~/server/utils/ably');
			const { RealtimePublishError } = await import('~~/server/utils/realtimePublishFailure');
			const { ServiceConfigurationError } = await import('~~/server/utils/errors');

			const failure = await publishScreenCommand(1, 10, 'identify').then(() => null, error => error);

			expect(failure).not.toBeInstanceOf(RealtimePublishError);
			expect(failure).toBeInstanceOf(ServiceConfigurationError);
			expect(failure.message).toContain('not configured');
			// The setting's own name, which is the whole reason the message is
			// allowed out of a 5xx at all (#233).
			expect(failure.setting).toBe('NUXT_ABLY_API_KEY');
		});

		it('reaches the caller as a 503 naming the setting, not as a sanitized 500', async () => {
			// Post-mapper, because the mapper is where this was being lost: the real
			// throw, through the real mapping. Shaped harsher than h3's own hand-over
			// — `createError` copies a truthy `statusCode`, so this error genuinely
			// arrives at 503 already — and starting from the sanitizer's worst case
			// proves the mapping rather than the arrival. 500 is what the *plain*
			// Error this replaced arrived as, which is where the bare 'Internal
			// Server Error' came from. `unhandled` is true either way, and clearing
			// it is what lets the message survive Nitro's own handler afterwards.
			vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: '' } as any);
			const { publishScreenCommand } = await import('~~/server/utils/ably');
			const { mapPublicNitroError } = await import('~~/server/utils/nitroErrorMapping');

			const cause = await publishScreenCommand(1, 10, 'identify').then(() => null, error => error);
			const error = { statusCode: 500, message: 'Something went wrong', cause, unhandled: true };

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'NUXT_ABLY_API_KEY is not configured',
				unhandled: false,
			});
		});
	});
});
