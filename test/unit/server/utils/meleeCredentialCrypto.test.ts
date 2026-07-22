import { describe, expect, it } from 'vitest';
import {
	decryptMeleeCredential,
	encryptMeleeCredential,
	isEncryptedMeleeCredential,
	MeleeCredentialCryptoError,
} from '~~/server/utils/meleeCredentialCrypto';

function base64Key(fill: number): string {
	return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

function keyring(activeKeyVersion = 'v1', keys: Record<string, string> = { v1: base64Key(1) }) {
	return {
		activeKeyVersion,
		keys: new Map(Object.entries(keys)),
	};
}

function envelopeJson(storedValue: string) {
	return JSON.parse(storedValue.slice(storedValue.indexOf('{'))) as {
		version: number;
		keyVersion: string;
		iv: string;
		ciphertext: string;
	};
}

describe('melee credential crypto', () => {
	it('round-trips an AES-256-GCM envelope without retaining plaintext', async () => {
		const plaintext = 'top-secret-client-credential';
		const encrypted = await encryptMeleeCredential(plaintext, keyring());
		const envelope = envelopeJson(encrypted);

		expect(isEncryptedMeleeCredential(encrypted)).toBe(true);
		expect(encrypted).not.toContain(plaintext);
		expect(envelope).toMatchObject({ version: 1, keyVersion: 'v1' });
		expect(envelope.iv).toEqual(expect.any(String));
		expect(envelope.ciphertext).toEqual(expect.any(String));

		await expect(decryptMeleeCredential(encrypted, keyring())).resolves.toEqual({
			plaintext,
			legacyPlaintext: false,
			keyVersion: 'v1',
			needsReEncryption: false,
		});
	});

	it('uses a fresh random IV for every save', async () => {
		const first = envelopeJson(await encryptMeleeCredential('same-secret', keyring()));
		const second = envelopeJson(await encryptMeleeCredential('same-secret', keyring()));

		expect(first.iv).not.toBe(second.iv);
		expect(first.ciphertext).not.toBe(second.ciphertext);
	});

	it('decrypts a previous key version and marks it for rotation', async () => {
		const encrypted = await encryptMeleeCredential('rotate-me', keyring('v1'));
		const rotated = keyring('v2', {
			v1: base64Key(1),
			v2: base64Key(2),
		});

		await expect(decryptMeleeCredential(encrypted, rotated)).resolves.toMatchObject({
			plaintext: 'rotate-me',
			keyVersion: 'v1',
			needsReEncryption: true,
		});
	});

	it('allows legacy plaintext only through the explicit compatibility option', async () => {
		await expect(decryptMeleeCredential('legacy-secret', keyring())).rejects.toMatchObject({
			code: 'MELEE_CREDENTIAL_LEGACY_PLAINTEXT',
		});
		await expect(decryptMeleeCredential('legacy-secret', keyring(), {
			allowLegacyPlaintext: true,
		})).resolves.toEqual({
			plaintext: 'legacy-secret',
			legacyPlaintext: true,
			keyVersion: null,
			needsReEncryption: true,
		});
	});

	it('fails clearly when the envelope key version is unavailable', async () => {
		const plaintext = 'never-include-this-secret';
		const encrypted = await encryptMeleeCredential(plaintext, keyring('retired', {
			retired: base64Key(3),
		}));

		let error: unknown;
		try {
			await decryptMeleeCredential(encrypted, keyring('current'));
		}
		catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(MeleeCredentialCryptoError);
		expect(error).toMatchObject({ code: 'MELEE_CREDENTIAL_KEY_MISSING' });
		expect((error as Error).message).toContain('retired');
		expect((error as Error).message).not.toContain(plaintext);
	});

	it('rejects malformed or tampered envelopes without exposing ciphertext', async () => {
		const encrypted = await encryptMeleeCredential('hidden', keyring());
		const envelope = envelopeJson(encrypted);
		const prefix = encrypted.slice(0, encrypted.indexOf('{'));
		const ciphertext = atob(envelope.ciphertext);
		envelope.ciphertext = btoa(String.fromCharCode(ciphertext.charCodeAt(0) ^ 1) + ciphertext.slice(1));
		const tampered = `${prefix}${JSON.stringify(envelope)}`;

		await expect(decryptMeleeCredential(`${prefix}{}`, keyring())).rejects.toMatchObject({
			code: 'MELEE_CREDENTIAL_UNSUPPORTED_VERSION',
		});
		await expect(decryptMeleeCredential(tampered, keyring())).rejects.toMatchObject({
			code: 'MELEE_CREDENTIAL_DECRYPTION_FAILED',
			message: expect.not.stringContaining(envelope.ciphertext),
		});
	});

	it('rejects keys that are not base64-encoded 256-bit values', async () => {
		const encryption = encryptMeleeCredential('secret', keyring('bad', { bad: btoa('too-short') }));

		await expect(encryption).rejects.toMatchObject({ code: 'MELEE_CREDENTIAL_INVALID_KEY' });
	});
});
