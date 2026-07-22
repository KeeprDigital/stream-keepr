import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireMeleeIntegration, requireMeleeService } from '~~/server/services/meleeIntegration';
import { MeleeCredentialCryptoError } from '~~/server/utils/meleeCredentialCrypto';

// Mock services
const { mockFetchMeleeEvent, mockMeleeService, mockRevealMeleeClientSecret, mockRewrapMeleeClientSecret } = vi.hoisted(() => {
	const fetchMeleeEvent = vi.fn();
	return {
		mockFetchMeleeEvent: fetchMeleeEvent,
		mockMeleeService: vi.fn(() => ({ fetchEvent: fetchMeleeEvent })),
		mockRevealMeleeClientSecret: vi.fn(),
		mockRewrapMeleeClientSecret: vi.fn(),
	};
});

vi.mock('~~/server/services/melee', () => ({
	meleeService: mockMeleeService,
}));
vi.mock('~~/server/services/meleeCredentials', () => ({
	revealMeleeClientSecret: mockRevealMeleeClientSecret,
}));
vi.mock('~~/server/services/meleeCredentialRotation', () => ({
	rewrapMeleeClientSecret: mockRewrapMeleeClientSecret,
}));

// Mock Nitro auto-import
vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message)
	;(err as any).statusCode = opts.statusCode;
	return err;
});

describe('requireMeleeIntegration', () => {
	beforeEach(() => {
		mockRewrapMeleeClientSecret.mockReset().mockResolvedValue(true);
		mockRevealMeleeClientSecret.mockReset().mockResolvedValue({
			plaintext: 'secret-1',
			legacyPlaintext: false,
			keyVersion: 'v1',
			needsReEncryption: false,
		});
	});

	it('decrypts stored credentials only when the adapter boundary is crossed', async () => {
		const result = await requireMeleeIntegration({
			meleeEnabled: true,
			meleeEventId: 'evt-1',
			meleeClientId: 'client-1',
			meleeClientSecret: 'encrypted-envelope',
		});
		expect(result).toEqual({
			clientId: 'client-1',
			clientSecret: 'secret-1',
			eventId: 'evt-1',
		});
		expect(mockRevealMeleeClientSecret).toHaveBeenCalledWith('encrypted-envelope', {
			allowLegacyPlaintext: true,
		});
		expect(mockRewrapMeleeClientSecret).not.toHaveBeenCalled();
	});

	it('opportunistically re-wraps legacy or rotated credentials with a CAS update', async () => {
		mockRevealMeleeClientSecret.mockResolvedValue({
			plaintext: 'legacy-secret',
			legacyPlaintext: true,
			keyVersion: null,
			needsReEncryption: true,
		});

		await requireMeleeIntegration({
			id: 42,
			meleeEnabled: true,
			meleeEventId: 'evt-1',
			meleeClientId: 'client-1',
			meleeClientSecret: 'legacy-secret',
		});

		expect(mockRewrapMeleeClientSecret).toHaveBeenCalledWith(42, 'legacy-secret', 'legacy-secret');
	});

	it('does not block valid credentials when opportunistic re-wrapping fails', async () => {
		const secret = 'legacy-secret-never-log';
		mockRevealMeleeClientSecret.mockResolvedValue({
			plaintext: secret,
			legacyPlaintext: true,
			keyVersion: null,
			needsReEncryption: true,
		});
		mockRewrapMeleeClientSecret.mockRejectedValue(new Error(`D1 failed for ${secret}`));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(requireMeleeIntegration({
			id: 42,
			meleeEnabled: true,
			meleeEventId: 'evt-1',
			meleeClientId: 'client-1',
			meleeClientSecret: 'stored-envelope',
		})).resolves.toEqual({
			clientId: 'client-1',
			clientSecret: secret,
			eventId: 'evt-1',
		});
		expect(warn).toHaveBeenCalledWith(JSON.stringify({
			message: 'melee_credential_rewrap_failed',
			eventId: 42,
		}));
		expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
		warn.mockRestore();
	});
});

describe('requireMeleeService', () => {
	beforeEach(() => {
		mockRewrapMeleeClientSecret.mockReset().mockResolvedValue(true);
		mockMeleeService.mockClear();
		mockFetchMeleeEvent.mockReset().mockResolvedValue({ ID: 1 });
		mockRevealMeleeClientSecret.mockReset().mockResolvedValue({
			plaintext: 'secret-1',
			legacyPlaintext: false,
			keyVersion: 'v1',
			needsReEncryption: false,
		});
	});

	it('defers decryption and service construction until the first API call', async () => {
		const result = requireMeleeService({
			meleeEnabled: true,
			meleeEventId: 'evt-1',
			meleeClientId: 'client-1',
			meleeClientSecret: 'encrypted-envelope',
		});

		expect(mockRevealMeleeClientSecret).not.toHaveBeenCalled();
		expect(mockMeleeService).not.toHaveBeenCalled();
		await expect(result.fetchEvent()).resolves.toEqual({ ID: 1 });
		expect(mockMeleeService).toHaveBeenCalledWith({
			clientId: 'client-1',
			clientSecret: 'secret-1',
			eventId: 'evt-1',
		});
	});

	it('surfaces missing-key failures without passing ciphertext to the adapter', async () => {
		const storedValue = 'encrypted-envelope-never-log';
		mockRevealMeleeClientSecret.mockRejectedValue(new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_MISSING',
			'Melee credential encryption key version "retired" is not configured',
		));
		const result = requireMeleeService({
			meleeEnabled: true,
			meleeEventId: 'evt-1',
			meleeClientId: 'client-1',
			meleeClientSecret: storedValue,
		});

		await expect(result.fetchEvent()).rejects.toMatchObject({
			code: 'MELEE_CREDENTIAL_KEY_MISSING',
			message: expect.not.stringContaining(storedValue),
		});
		expect(mockMeleeService).not.toHaveBeenCalled();
	});
});
