import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
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

		it('normalizes legacy Graphic Layer Order and media presentation on reads', () => {
			const overlay = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			overlay.layout.items = [
				{
					...overlay.layout.items[0]!,
					id: 'front',
					zIndex: 20,
				},
				{
					id: 'legacy-media',
					type: 'media',
					label: 'Legacy media',
					visible: true,
					x: 0,
					y: 0,
					width: 640,
					height: 360,
					mediaKind: 'image',
					fit: 'cover',
					opacity: 1,
					borderRadius: 16,
					surfaceStyle: { backgroundColor: '#fff' },
				},
				{
					...overlay.layout.items[1]!,
					id: 'back',
					zIndex: 1,
				},
			] as never;
			const screen = createMockScreen({
				modeConfigs: { 'feature-match-overlay': overlay },
			});

			const result = mapScreenToResponse(screen);
			const items = result.modeConfigs?.['feature-match-overlay'].layout.items ?? [];
			expect(items.map(item => item.id)).toEqual(['legacy-media', 'back', 'front']);
			expect(items.every(item => !('zIndex' in item))).toBe(true);
			expect(items[0]).toMatchObject({
				type: 'media',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				clipGeometry: {
					topLeft: { kind: 'rounded', size: 16 },
					topRight: { kind: 'rounded', size: 16 },
					bottomRight: { kind: 'rounded', size: 16 },
					bottomLeft: { kind: 'rounded', size: 16 },
				},
			});
			expect(items[0]).not.toHaveProperty('surfaceStyle');
			expect(items[0]).not.toHaveProperty('borderRadius');
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
