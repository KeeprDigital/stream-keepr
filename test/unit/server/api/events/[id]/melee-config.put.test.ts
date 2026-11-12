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
// The Card Game refusal has its home in meleeSync.sqlite; these Events are MTG.
vi.mock('~~/server/modules/melee-sync/eventData', () => ({
	requireMeleeSyncEventData: vi.fn(),
	requireMeleeSyncOffered: vi.fn(),
}));
vi.mock('~~/server/services/meleeIntegration', () => ({
	requireMeleeIntegration: mockRequireMeleeIntegration,
}));
vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => ({
		eventUpdated: mockPublishEventUpdated,
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

// Distinguishable from the bare `{}` other rows pass to `setResponseHeader`.
const requestEvent = { __requestEventFor: 'melee-config' } as any;

// The upstream and keyring failures only a stand-in can force, and the answer each
// becomes. What the route stores, resets and announces is `melee-config.put.sqlite.test.ts`'s.
describe('pUT /api/events/[id]/melee-config credential boundary', () => {
	beforeEach(() => {
		mockGetValidatedRouterParams.mockReset().mockResolvedValue({ id: 1 });
		mockReadValidatedBody.mockReset().mockResolvedValue({
			meleeEnabled: true,
			meleeEventId: ' 123 ',
			meleeClientId: ' client-id ',
		});
		mockFindEvent.mockReset()
			.mockResolvedValueOnce({
				id: 1,
				game: 'mtg',
				meleeEnabled: true,
				meleeEventId: '123',
				meleeClientSecret: 'stored-envelope',
			})
			.mockResolvedValueOnce({
				id: 1,
				meleeEnabled: true,
				meleeEventId: '123',
				meleeClientSecret: 'new-envelope',
			});
		mockUpdateMeleeConfig.mockReset().mockResolvedValue({
			clearedScreens: [],
			keptStructure: { keptPhases: [], keptRounds: [] },
		});
		mockFetchMeleeEvent.mockReset().mockResolvedValue({ ID: 123, Game: 'Magic: The Gathering' });
		mockRequireMeleeIntegration.mockReset().mockResolvedValue({
			clientId: 'client-id',
			clientSecret: 'decrypted-client-secret',
			eventId: '123',
		});
		mockPublishEventUpdated.mockReset().mockResolvedValue({ id: 1, meleeConfigured: true });
		mockGetOriginConnectionId.mockReset().mockReturnValue('origin-1');
		mockAcquireMeleeSyncLease.mockReset().mockResolvedValue({
			token: 'config-token',
			command: 'configuration',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		mockReleaseMeleeSyncLease.mockReset().mockResolvedValue(true);
		mockSetResponseHeader.mockReset();
	});

	it('does not replace a committed configuration result when lease cleanup fails', async () => {
		mockReleaseMeleeSyncLease.mockRejectedValue(new Error('D1 unavailable'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(handler({} as any)).resolves.toEqual({ id: 1, meleeConfigured: true });

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('event 1'));
		expect(JSON.stringify(warn.mock.calls)).not.toContain('config-token');
		warn.mockRestore();
	});

	// A keyring fault names the setting to fix and survives the sanitizer (#347).
	it('answers a keyring configuration fault by naming the setting an operator must fix', async () => {
		const storedValue = 'stored-envelope-never-log';
		mockFindEvent.mockReset().mockResolvedValue({ id: 1, meleeClientSecret: storedValue });
		mockRequireMeleeIntegration.mockRejectedValue(new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_MISSING',
			'Melee credential encryption key version "retired" is not configured',
		));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const refusal = await refusalFrom(handler({} as any));

		expect(refusal.statusCode).toBe(503);
		expect(refusal.statusMessage).toBe('Service Unavailable');
		expect(refusal.message).toBe(
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY or NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS is missing a key version that stored Melee credentials need',
		);
		// The crypto library's own words name a key version; the public sentence
		// names settings only, and the code travels on the cause, not in the body.
		expect(refusal.message).not.toContain('retired');
		expect((refusal as { data?: unknown }).data).toBeUndefined();
		expect(warn).not.toHaveBeenCalled();
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(mockReleaseMeleeSyncLease).toHaveBeenCalledWith(1, 'config-token');
		warn.mockRestore();
	});

	it('answers the same fault from the final persistence boundary the same way', async () => {
		mockUpdateMeleeConfig.mockRejectedValue(new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_MISSING',
			'Melee credential encryption key version "active" is not configured',
		));

		const refusal = await refusalFrom(handler({} as any));

		expect(refusal.statusCode).toBe(503);
		expect(refusal.message).toBe(
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY or NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS is missing a key version that stored Melee credentials need',
		);
		expect(mockPublishEventUpdated).not.toHaveBeenCalled();
		expect(mockReleaseMeleeSyncLease).toHaveBeenCalledWith(1, 'config-token');
	});

	// A corrupt stored envelope stays a sanitized 500 with no crypto code in the body (#347).
	it('sanitizes a corrupt stored envelope and keeps the crypto code out of the body', async () => {
		mockRequireMeleeIntegration.mockRejectedValue(new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_DECRYPTION_FAILED',
			'Stored Melee credential could not be decrypted',
		));

		const refusal = await refusalFrom(handler({} as any));

		expect(refusal.statusCode).toBe(500);
		expect(refusal.message).toBe('Internal Server Error');
		expect((refusal as { data?: unknown }).data).toBeUndefined();
		expect(JSON.stringify({ statusCode: refusal.statusCode, statusMessage: refusal.statusMessage, message: refusal.message }))
			.not
			.toContain('MELEE_CREDENTIAL');
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(mockReleaseMeleeSyncLease).toHaveBeenCalledWith(1, 'config-token');
	});

	it('does not misreport an upstream outage as invalid credentials', async () => {
		// An outage (502) is not refused credentials (422), and nothing is persisted.
		mockFetchMeleeEvent.mockRejectedValue(new MeleeTransportError(
			'Melee.gg API request failed with status 503',
			'http',
			503,
		));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const refusal = await refusalFrom(handler(requestEvent));

		expect(refusal.statusCode).toBe(502);
		expect(refusal.statusMessage).toBe('Bad Gateway');
		expect(refusal.message).toBe('Melee.gg is temporarily unavailable. Try again later.');
		expect(mockUpdateMeleeConfig).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	// A sentence calling the outage temporary comes with how long to wait (#346).
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
		// A timeout and a bad gateway carry the same advice, so the same interval.
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
		// An unreachable Melee.gg resolves by waiting; refused credentials do not.
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
});
