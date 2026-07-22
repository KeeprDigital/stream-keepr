import { describe, expect, it } from 'vitest';
import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { createMockPhase } from '~~/test/helpers/fixtures';

describe('mapPhaseToResponse', () => {
	it('converts createdAt and updatedAt to Date instances', () => {
		const phase = createMockPhase({
			createdAt: '2026-01-01T00:00:00.000Z' as unknown as Date,
			updatedAt: '2026-01-02T00:00:00.000Z' as unknown as Date,
		});

		const result = mapPhaseToResponse(phase);

		expect(result.createdAt).toBeInstanceOf(Date);
		expect(result.updatedAt).toBeInstanceOf(Date);
	});

	it('preserves Date objects that are already Date instances', () => {
		const createdAt = new Date('2026-01-01T00:00:00.000Z');
		const updatedAt = new Date('2026-01-02T00:00:00.000Z');
		const phase = createMockPhase({ createdAt, updatedAt });

		const result = mapPhaseToResponse(phase);

		expect(result.createdAt).toBeInstanceOf(Date);
		expect(result.updatedAt).toBeInstanceOf(Date);
	});

	it('preserves all phase fields in the response', () => {
		const phase = createMockPhase({
			id: 5,
			eventId: 10,
			name: 'Top 8',
			sortOrder: 2,
			externalId: 'ext-1',
			externalSource: 'melee',
		});

		const result = mapPhaseToResponse(phase);

		expect(result.id).toBe(5);
		expect(result.eventId).toBe(10);
		expect(result.name).toBe('Top 8');
		expect(result.sortOrder).toBe(2);
		expect(result.externalId).toBe('ext-1');
		expect(result.externalSource).toBe('melee');
	});

	it('preserves null optional fields', () => {
		const phase = createMockPhase({
			externalId: null,
			externalSource: null,
		});

		const result = mapPhaseToResponse(phase);

		expect(result.externalId).toBeNull();
		expect(result.externalSource).toBeNull();
	});
});
