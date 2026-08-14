import { H3Error } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeleeTransportError } from '~~/server/services/meleeTransport';
import { MeleeCredentialCryptoError } from '~~/server/utils/meleeCredentialCrypto';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';

const mockGetValidatedRouterParams = vi.fn();
const mockReadValidatedBody = vi.fn();
const mockFindEvent = vi.fn();
const mockUpdateMeleeConfig = vi.fn();
const mockFetchMeleeEvent = vi.fn();
const mockRequireMeleeIntegration = vi.fn();
const mockPublishEventUpdated = vi.fn();
const mockPublishMeleeDataReset = vi.fn();
const mockGetOriginConnectionId = vi.fn();
const mockAcquireMeleeSyncLease = vi.fn();
const mockReleaseMeleeSyncLease = vi.fn();
const mockEventParamsParse = vi.fn(input => input);
const mockMeleeConfigParse = vi.fn(input => input);
const mockSetResponseHeader = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('readValidatedBody', mockReadValidatedBody);
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('createError', vi.fn((input: { statusCode: number; message: string; data?: unknown }) => {
	return Object.assign(new Error(input.message), input);
}));

vi.mock('~~/server/schemas/api/event', () => ({
	eventParamsSchema: { parse: mockEventParamsParse },
	meleeConfigUpdateSchema: { parse: mockMeleeConfigParse },
}));
vi.mock('~~/server/services/event', () => ({
	eventService: () => ({
		findById: mockFindEvent,
		updateMeleeConfig: mockUpdateMeleeConfig,
	}),
}));
vi.mock('~~/server/services/melee', () => ({
	meleeService: () => ({ fetchEvent: mockFetchMeleeEvent }),
}));
vi.mock('~~/server/modules/melee-sync/workflows', () => ({
	createMeleeSyncWorkflows: () => ({}),
}));
vi.mock('~~/server/modules/melee-sync/eventData', () => ({
	requireMeleeSyncEventData: vi.fn(),
}));
vi.mock('~~/server/services/meleeIntegration', () => ({
	requireMeleeIntegration: mockRequireMeleeIntegration,
}));
vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => ({
		eventUpdated: mockPublishEventUpdated,
		meleeDataReset: mockPublishMeleeDataReset,
	}),
}));
vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: mockGetOriginConnectionId,
}));
vi.mock('~~/server/utils/meleeSyncState', () => ({
	acquireMeleeSyncLease: mockAcquireMeleeSyncLease,
	releaseMeleeSyncLease: mockReleaseMeleeSyncLease,
}));

const handler = (await import('~~/server/api/events/[id]/melee-config.put')).default;

// Carries a distinguishing property on purpose: `toHaveBeenCalledWith` compares
// deeply, so the bare `{}` the rows around it pass cannot tell the request the route
// was answering apart from any other empty object a careless edit might hand
// `setResponseHeader`.
const requestEvent = { __requestEventFor: 'melee-config' } as any;

describe('pUT /api/events/[id]/melee-config credential boundary', () => {
	beforeEach(() => {
		mockGetValidatedRouterParams.mockReset().mockResolvedValue({ id: 1 });
		mockReadValidatedBody.mockReset().mockResolvedValue({
			meleeEnabled: true,
			meleeEventId: ' 123 ',
			meleeClientId: ' client-id ',
		});
		mockFindEvent.mockReset()
			.mockResolvedValueOnce({ id: 1, game: 'mtg', meleeEnabled: true, meleeEventId: '123', meleeClientSecret: 'stored-envelope' })
			.mockResolvedValueOnce({ id: 1, meleeEnabled: true, meleeEventId: '123', meleeClientSecret: 'new-envelope' });
		mockUpdateMeleeConfig.mockReset().mockResolvedValue(true);
		mockFetchMeleeEvent.mockReset().mockResolvedValue({ ID: 123, Game: 'Magic: The Gathering' });
		mockRequireMeleeIntegration.mockReset().mockResolvedValue({
			clientId: 'client-id',
			clientSecret: 'decrypted-client-secret',
			eventId: '123',
		});
		mockPublishEventUpdated.mockReset().mockResolvedValue({ id: 1, meleeConfigured: true });
		mockPublishMeleeDataReset.mockReset().mockResolvedValue(undefined);
		mockGetOriginConnectionId.mockReset().mockReturnValue('origin-1');
		mockAcquireMeleeSyncLease.mockReset().mockResolvedValue({
			token: 'config-token',
			command: 'configuration',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		mockReleaseMeleeSyncLease.mockReset().mockResolvedValue(true);
		mockSetResponseHeader.mockReset();
	});

	it('decrypts an existing envelope for validation and re-saves plaintext through the encrypting service boundary', async () => {
		await expect(handler({} as any)).resolves.toEqual({ id: 1, meleeConfigured: true });
		expect(mockRequireMeleeIntegration).toHaveBeenCalledWith({
			meleeEnabled: true,
			meleeEventId: '123',
			meleeClientId: 'client-id',
			meleeClientSecret: 'stored-envelope',
		});
		expect(mockUpdateMeleeConfig).toHaveBeenCalledWith(1, {
			meleeEnabled: true,
			meleeEventId: '123',
			meleeClientId: 'client-id',
			meleeClientSecret: 'decrypted-client-secret',
		});
		expect(mockAcquireMeleeSyncLease).toHaveBeenCalledWith(1, 'configuration');
		expect(mockAcquireMeleeSyncLease.mock.invocationCallOrder[0]).toBeLessThan(
			mockFindEvent.mock.invocationCallOrder[0]!,
		);
		expect(mockReleaseMeleeSyncLease).toHaveBeenCalledWith(1, 'config-token');
		expect(mockPublishMeleeDataReset).not.toHaveBeenCalled();
	});

	it('publishes a reset delta after a successful Melee event change', async () => {
		mockReadValidatedBody.mockResolvedValue({
			meleeEnabled: true,
			meleeEventId: '456',
			meleeClientId: 'client-id',
		});
		mockFindEvent.mockReset()
			.mockResolvedValueOnce({ id: 1, game: 'mtg', meleeEnabled: true, meleeEventId: '123', meleeClientSecret: 'stored-envelope' })
			.mockResolvedValueOnce({ id: 1, meleeEnabled: true, meleeEventId: '456', meleeClientSecret: 'new-envelope' });
		mockRequireMeleeIntegration.mockResolvedValue({
			clientId: 'client-id',
			clientSecret: 'decrypted-client-secret',
			eventId: '456',
		});
		mockFetchMeleeEvent.mockResolvedValue({ ID: 456, Game: 'Magic: The Gathering' });

		await expect(handler({} as any)).resolves.toEqual({ id: 1, meleeConfigured: true });

		expect(mockPublishMeleeDataReset).toHaveBeenCalledWith({
			eventId: 1,
			originConnectionId: 'origin-1',
			reason: 'event-changed',
		});
	});

	it('publishes a reset delta after disabling the integration', async () => {
		mockReadValidatedBody.mockResolvedValue({
			meleeEnabled: false,
			meleeEventId: null,
			meleeClientId: null,
		});
		mockFindEvent.mockReset()
			.mockResolvedValueOnce({ id: 1, meleeEnabled: true, meleeEventId: '123', meleeClientSecret: 'stored-envelope' })
			.mockResolvedValueOnce({ id: 1, meleeEnabled: false, meleeEventId: null, meleeClientSecret: null });

		await expect(handler({} as any)).resolves.toEqual({ id: 1, meleeConfigured: true });

		expect(mockRequireMeleeIntegration).not.toHaveBeenCalled();
		expect(mockPublishMeleeDataReset).toHaveBeenCalledWith({
			eventId: 1,
			originConnectionId: 'origin-1',
			reason: 'disabled',
		});
	});

	it('does not replace a committed configuration result when lease cleanup fails', async () => {
		mockReleaseMeleeSyncLease.mockRejectedValue(new Error('D1 unavailable'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(handler({} as any)).resolves.toEqual({ id: 1, meleeConfigured: true });

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('event 1'));
		expect(JSON.stringify(warn.mock.calls)).not.toContain('config-token');
		warn.mockRestore();
	});

	it('surfaces encrypted-value configuration failures without logging credential material', async () => {
		const storedValue = 'stored-envelope-never-log';
		mockFindEvent.mockReset().mockResolvedValue({ id: 1, meleeClientSecret: storedValue });
		mockRequireMeleeIntegration.mockRejectedValue(new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_MISSING',
			'Melee credential encryption key version "retired" is not configured',
		));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(handler({} as any)).rejects.toMatchObject({
			statusCode: 500,
			data: { code: 'MELEE_CREDENTIAL_KEY_MISSING' },
			message: 'Melee credential encryption is unavailable',
		});
		expect(warn).not.toHaveBeenCalled();
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(mockReleaseMeleeSyncLease).toHaveBeenCalledWith(1, 'config-token');
		warn.mockRestore();
	});

	it('surfaces encryption failures from the final persistence boundary with their stable code', async () => {
		mockUpdateMeleeConfig.mockRejectedValue(new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_MISSING',
			'Melee credential encryption key version "active" is not configured',
		));

		await expect(handler({} as any)).rejects.toMatchObject({
			statusCode: 500,
			data: { code: 'MELEE_CREDENTIAL_KEY_MISSING' },
			message: 'Melee credential encryption is unavailable',
		});
		expect(mockPublishEventUpdated).not.toHaveBeenCalled();
		expect(mockReleaseMeleeSyncLease).toHaveBeenCalledWith(1, 'config-token');
	});

	it('does not misreport an upstream outage as invalid credentials', async () => {
		mockFetchMeleeEvent.mockRejectedValue(new MeleeTransportError(
			'Melee.gg API request failed with status 503',
			'http',
			503,
		));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(handler({} as any)).rejects.toMatchObject({
			statusCode: 502,
			statusMessage: 'Bad Gateway',
			message: 'Melee.gg is temporarily unavailable. Try again later.',
		});
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	/**
	 * The number that goes with the word *temporarily*.
	 *
	 * #346, the first of the two sites #337's review found still carrying its defect:
	 * the sentence called the outage momentary and the response carried no
	 * `retry-after`, so a caller told to come back had to invent an interval. Asserted
	 * after `mapPublicNitroError` because that is the response a caller actually
	 * receives — the header and the sentence are one piece of guidance, and #321's
	 * finding was precisely the two halves disagreeing. A row reading the header off
	 * the raw throw would pass with the sentence sanitized away.
	 */
	it('tells a caller how long to wait for Melee.gg, beside a sentence saying what for', async () => {
		mockFetchMeleeEvent.mockRejectedValue(new MeleeTransportError(
			'Melee.gg API request failed with status 503',
			'http',
			503,
		));
		const refusal = await refusalFrom(handler(requestEvent));

		expect(refusal.statusCode).toBe(502);
		expect(refusal.message).toBe('Melee.gg is temporarily unavailable. Try again later.');
		expect(mockSetResponseHeader).toHaveBeenCalledWith(requestEvent, 'retry-after', 5);
	});

	it('gives the same interval when the upstream timed out rather than answered', async () => {
		// The status here is the one thing about this refusal that varies, and it varies
		// on the same line the header now sits beside. A number written into either
		// branch of that conditional would leave a caller who timed out with no interval
		// and a caller who got a bad gateway with one.
		mockFetchMeleeEvent.mockRejectedValue(new MeleeTransportError(
			'Melee.gg API request timed out',
			'timeout',
		));
		const refusal = await refusalFrom(handler(requestEvent));

		expect(refusal.statusCode).toBe(504);
		expect(refusal.message).toBe('Melee.gg is temporarily unavailable. Try again later.');
		expect(mockSetResponseHeader).toHaveBeenCalledWith(requestEvent, 'retry-after', 5);
	});

	it('does not tell a caller to wait for credentials Melee.gg refused', async () => {
		// The counterweight, and the same distinction `requireGraphicsAdministrator`
		// makes: an unreachable Melee.gg resolves by waiting and a rejected client ID
		// does not — waiting only makes it later. A `retry-after` set once for the whole
		// `MeleeTransportError` branch would satisfy the two rows above and be wrong
		// here, which is what this exists to catch.
		mockFetchMeleeEvent.mockRejectedValue(new MeleeTransportError(
			'Melee.gg API request failed with status 401',
			'http',
			401,
		));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 400 });

		expect(mockSetResponseHeader).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it('reports an upstream Event ID mismatch as invalid configuration', async () => {
		mockFetchMeleeEvent.mockResolvedValue({ ID: 999 });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(handler({} as any)).rejects.toMatchObject({
			statusCode: 400,
			message: 'Could not validate Melee.gg credentials. Check the event ID, client ID, and client secret.',
		});
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(JSON.stringify({ message: 'melee_credential_validation_failed' }));
		warn.mockRestore();
	});

	it('rejects a known upstream game mismatch before replacing the integration', async () => {
		mockFetchMeleeEvent.mockResolvedValue({ ID: 123, Game: 'One Piece Card Game' });

		await expect(handler({} as any)).rejects.toMatchObject({
			statusCode: 422,
			message: 'The selected Melee.gg tournament uses a different game than this Event',
			data: { code: 'MELEE_GAME_MISMATCH' },
		});
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
	});

	it('preserves intentional client validation errors', async () => {
		const validationError = new H3Error('Melee.gg credentials not configured for this event');
		validationError.statusCode = 400;
		mockRequireMeleeIntegration.mockRejectedValue(validationError);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(handler({} as any)).rejects.toBe(validationError);
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it('rethrows unknown validation failures for server-error sanitization', async () => {
		const failure = Object.assign(new Error('D1 connection details must not become a 400'), {
			statusCode: 400,
		});
		mockFetchMeleeEvent.mockRejectedValue(failure);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(handler({} as any)).rejects.toBe(failure);
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it('rejects configuration changes while another sync command owns the event', async () => {
		const conflict = Object.assign(new Error('Melee sync command "players" is already running for this event'), {
			statusCode: 409,
			data: { code: 'MELEE_SYNC_IN_PROGRESS' },
		});
		mockAcquireMeleeSyncLease.mockRejectedValue(conflict);

		await expect(handler({} as any)).rejects.toBe(conflict);

		expect(mockRequireMeleeIntegration).not.toHaveBeenCalled();
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(mockReleaseMeleeSyncLease).not.toHaveBeenCalled();
	});
});
