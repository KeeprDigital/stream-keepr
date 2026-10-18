import { describe, expect, it } from 'vitest';
import { INTEGRATION_EVENT_ID_BLOCK_SIZE, integrationEventIdBlocks } from '~~/test/integration/state';

/**
 * That no two integration servers mint the same Event id (#630).
 *
 * Every server owns its own D1, but all of them publish to one Ably app, and an
 * Event's channel is named by its id alone. Two servers that both create Event 17
 * deliver each other's publications to whichever test is listening on `event:17`.
 */

const INT32_MAX = 2 ** 31 - 1;

describe('integrationEventIdBlocks', () => {
	it('gives each server its own block even when the draw repeats', () => {
		const firstIds = integrationEventIdBlocks(4, () => 0.5);

		expect(firstIds).toHaveLength(4);
		const blocks = firstIds.map(id => Math.floor(id / INTEGRATION_EVENT_ID_BLOCK_SIZE));
		expect(new Set(blocks).size).toBe(4);
		for (const id of firstIds)
			expect(id % INTEGRATION_EVENT_ID_BLOCK_SIZE).toBe(0);
	});

	it('keeps every id a block can mint a positive int32, at either end of the draw', () => {
		for (const draw of [0, 1 - Number.EPSILON]) {
			for (const firstId of integrationEventIdBlocks(4, () => draw)) {
				expect(firstId).toBeGreaterThan(0);
				expect(firstId + INTEGRATION_EVENT_ID_BLOCK_SIZE - 1).toBeLessThanOrEqual(INT32_MAX);
			}
		}
	});
});
