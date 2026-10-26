import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { createMockScreen } from '~~/test/helpers/fixtures';

describe('screen mapper', () => {
	it('never exposes capability material or internal reference markers', () => {
		const result = mapScreenToResponse(createMockScreen());

		expect(result).not.toHaveProperty('assetCapabilitySeed');
		expect(result).not.toHaveProperty('assetCapabilityVersion');
		expect(result).not.toHaveProperty('assetCapabilityDigest');
		expect(result).not.toHaveProperty('graphicAssetReferenceVersion');
	});

	it('carries no Screen Card, so only the Card read answers it (ADR-0022)', () => {
		const result = mapScreenToResponse(createMockScreen({
			activeCard: { id: 'card-1', name: 'Bolt', savedAt: 1 } as never,
			activeCardVersion: 3,
		}));

		expect(result).not.toHaveProperty('activeCard');
		expect(result).not.toHaveProperty('activeCardVersion');
	});
});
