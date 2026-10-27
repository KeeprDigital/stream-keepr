import type { DbEvent } from '~~/server/db/schema';
import { describe, expect, it } from 'vitest';
import { mapEventListToResponse, mapEventToResponse } from '~~/server/mappers/event';
import { createMockEvent, createMockTalent } from '~~/test/helpers/fixtures';

const mappers = [
	[
		'mapEventListToResponse',
		(event: DbEvent) => mapEventListToResponse(event),
	],
	[
		'mapEventToResponse',
		(event: DbEvent) => mapEventToResponse({ ...event, talents: [] }),
	],
] as const;

describe.each(mappers)('event mapper %s', (_name, map) => {
	it('never exposes the Melee credentials', () => {
		const result = map(createMockEvent({
			meleeClientId: 'my-client-id',
			meleeClientSecret: 'my-client-secret',
		}));

		expect(result).not.toHaveProperty('meleeClientId');
		expect(result).not.toHaveProperty('meleeClientSecret');
		expect(JSON.stringify(result)).not.toContain('my-client-secret');
	});

	it.each([
		['both set', 'id', 'secret', true],
		['no client ID', null, 'secret', false],
		['no secret', 'id', null, false],
		['neither', null, null, false],
	])('reports meleeConfigured with %s', (_case, meleeClientId, meleeClientSecret, configured) => {
		expect(map(createMockEvent({ meleeClientId, meleeClientSecret })).meleeConfigured).toBe(configured);
	});

	it('never exposes the Melee sync lease', () => {
		const result = map(createMockEvent({
			meleeSyncLeaseToken: 'opaque-token',
			meleeSyncLeaseCommand: 'update',
			meleeSyncLeaseExpiresAt: new Date('2026-01-01T00:15:00.000Z'),
		}));

		expect(result).not.toHaveProperty('meleeSyncLeaseToken');
		expect(result).not.toHaveProperty('meleeSyncLeaseCommand');
		expect(result).not.toHaveProperty('meleeSyncLeaseExpiresAt');
	});

	it('shows Live Results state but never its poll schedule', () => {
		const checkedAt = new Date('2026-01-01T00:10:00.000Z');
		const result = map(createMockEvent({
			meleeLiveResultsEnabled: true,
			meleeLiveResultsNextCheckAt: new Date('2026-01-01T00:11:00.000Z'),
			meleeLiveResultsBackoffStep: 2,
			meleeLiveResultsLastCheckedAt: checkedAt,
			meleeLiveResultsLastChangeAt: checkedAt,
			meleeLiveResultsError: 'Melee.gg is unavailable',
			meleeLiveResultsStopReason: 'idle',
		}));

		expect(result).toMatchObject({
			meleeLiveResultsEnabled: true,
			meleeLiveResultsLastCheckedAt: checkedAt,
			meleeLiveResultsLastChangeAt: checkedAt,
			meleeLiveResultsError: 'Melee.gg is unavailable',
			meleeLiveResultsStopReason: 'idle',
		});
		expect(result).not.toHaveProperty('meleeLiveResultsNextCheckAt');
		expect(result).not.toHaveProperty('meleeLiveResultsBackoffStep');
	});
});

describe('mapEventToResponse', () => {
	it('includes mapped Talents with their Social Profile maps', () => {
		const talent = createMockTalent({ id: 5, name: 'Cedric Phillips', twitchHandle: 'Cedric' });
		const result = mapEventToResponse({
			...createMockEvent(),
			talents: [talent],
		});

		expect(result.talents).toEqual([
			expect.objectContaining({
				name: 'Cedric Phillips',
				socialProfiles: { twitch: 'Cedric' },
			}),
		]);
		expect(result.talents[0]).not.toHaveProperty('twitchHandle');
	});
});
