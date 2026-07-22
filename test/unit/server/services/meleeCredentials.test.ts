import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRuntimeConfig = vi.fn();
vi.stubGlobal('useRuntimeConfig', mockRuntimeConfig);

const {
	getMeleeCredentialKeyring,
	protectMeleeClientSecret,
	revealMeleeClientSecret,
} = await import('~~/server/services/meleeCredentials');

function base64Key(fill: number): string {
	return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

describe('melee credential runtime service', () => {
	beforeEach(() => {
		mockRuntimeConfig.mockReset().mockReturnValue({
			meleeCredentialEncryptionKey: base64Key(2),
			meleeCredentialEncryptionKeyVersion: 'v2',
			meleeCredentialEncryptionPreviousKeys: JSON.stringify({ v1: base64Key(1) }),
		});
	});

	it('encrypts with the active deployment key and decrypts at the adapter boundary', async () => {
		const protectedValue = await protectMeleeClientSecret('client-secret');

		expect(protectedValue).not.toContain('client-secret');
		await expect(revealMeleeClientSecret(protectedValue)).resolves.toMatchObject({
			plaintext: 'client-secret',
			keyVersion: 'v2',
			needsReEncryption: false,
		});
	});

	it('makes previous deployment keys available for rotation', () => {
		const keyring = getMeleeCredentialKeyring();

		expect(keyring.activeKeyVersion).toBe('v2');
		expect(keyring.keys.get('v1')).toBe(base64Key(1));
		expect(keyring.keys.get('v2')).toBe(base64Key(2));
	});

	it('reports malformed previous-key configuration without including its contents', () => {
		const configuredValue = '{not-json-secret-material}';
		mockRuntimeConfig.mockReturnValue({
			meleeCredentialEncryptionKey: base64Key(2),
			meleeCredentialEncryptionKeyVersion: 'v2',
			meleeCredentialEncryptionPreviousKeys: configuredValue,
		});

		expect(() => getMeleeCredentialKeyring()).toThrowError(expect.objectContaining({
			code: 'MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID',
			message: expect.not.stringContaining(configuredValue),
		}));
	});
});
