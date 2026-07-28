import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { createMockScreen } from '~~/test/helpers/fixtures';

describe('screen mapper', () => {
	describe('mapScreenToResponse', () => {
		it('converts createdAt and updatedAt to Date instances', () => {
			const screen = createMockScreen({
				createdAt: '2026-08-01T06:00:00.000Z' as unknown as Date,
				updatedAt: '2026-08-01T07:00:00.000Z' as unknown as Date,
			});
			const result = mapScreenToResponse(screen);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-08-01T06:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-08-01T07:00:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-01-01T00:00:00.000Z');
			const updated = new Date('2026-01-02T00:00:00.000Z');
			const screen = createMockScreen({ createdAt: created, updatedAt: updated });
			const result = mapScreenToResponse(screen);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('preserves all screen fields in the response', () => {
			const screen = createMockScreen({
				id: 15,
				eventId: 4,
				name: 'Main Stage',
				slug: 'main-stage',
				currentMode: 'match',
				stateVersion: 3,
			});
			const result = mapScreenToResponse(screen);

			expect(result.id).toBe(15);
			expect(result.eventId).toBe(4);
			expect(result.name).toBe('Main Stage');
			expect(result.slug).toBe('main-stage');
			expect(result.currentMode).toBe('match');
			expect(result.stateVersion).toBe(3);
		});

		it('preserves null optional fields', () => {
			const screen = createMockScreen({
				modeConfigs: null,
				screenConfig: null,
			});
			const result = mapScreenToResponse(screen);

			expect(result.modeConfigs).toBeNull();
			expect(result.screenConfig).toBeNull();
		});

		it('never exposes capability material or internal reference markers', () => {
			const result = mapScreenToResponse(createMockScreen());

			expect(result).not.toHaveProperty('assetCapabilitySeed');
			expect(result).not.toHaveProperty('assetCapabilityVersion');
			expect(result).not.toHaveProperty('assetCapabilityDigest');
			expect(result).not.toHaveProperty('graphicAssetReferenceVersion');
		});
	});
});
