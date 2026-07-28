import { describe, expect, it } from 'vitest';
import {
	createScreenOutputAssetCapability,
	screenOutputAssetCapabilityDigest,
} from '~~/server/modules/screen-output-assets/capability';

describe('screen Output Asset Capability', () => {
	it('derives one opaque repeatable capability and a non-secret lookup digest', async () => {
		const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

		const capability = await createScreenOutputAssetCapability({
			signingKey,
			seed: 'd7b2c796-67f2-4c46-b424-c77b657e6ce7',
			version: 3,
		});

		expect(capability).toMatch(/^[\w-]{43}$/);
		await expect(createScreenOutputAssetCapability({
			signingKey,
			seed: 'd7b2c796-67f2-4c46-b424-c77b657e6ce7',
			version: 3,
		})).resolves.toBe(capability);
		await expect(
			screenOutputAssetCapabilityDigest(capability),
		).resolves.toMatch(/^[\da-f]{64}$/);
		expect(await screenOutputAssetCapabilityDigest(capability)).not.toContain(capability);
	});

	it('changes the capability when its revocation version changes', async () => {
		const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
		const seed = 'd7b2c796-67f2-4c46-b424-c77b657e6ce7';

		const previous = await createScreenOutputAssetCapability({
			signingKey,
			seed,
			version: 1,
		});
		const rotated = await createScreenOutputAssetCapability({
			signingKey,
			seed,
			version: 2,
		});

		expect(rotated).not.toBe(previous);
		const previousDigest = await screenOutputAssetCapabilityDigest(previous);
		const rotatedDigest = await screenOutputAssetCapabilityDigest(rotated);
		expect(rotatedDigest).not.toBe(previousDigest);
	});

	it('rejects an invalid signing key before deriving a capability', async () => {
		await expect(createScreenOutputAssetCapability({
			signingKey: 'not-a-32-byte-base64-key',
			seed: 'd7b2c796-67f2-4c46-b424-c77b657e6ce7',
			version: 1,
		})).rejects.toThrow('32-byte base64');
	});
});
