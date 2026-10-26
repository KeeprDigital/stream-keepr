import type { MessagePayload } from '~~/shared/types/messages';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createMessage } from '~~/shared/types/messages';

describe('createMessage', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('stamps the Event, the send time and the payload, plus the sender\'s connection when given', () => {
		const msg = createMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123');

		expect(msg).toMatchObject({
			eventId: 1,
			timestamp: Date.now(),
			originConnectionId: 'conn-123',
		});
		expect(createMessage(1, 'event:deleted').originConnectionId).toBeUndefined();
	});
});

// Every holder orders Card states by the revision a write committed (#734).
describe('the Card announcements', () => {
	it('carry the Card revision', () => {
		expect(createMessage(1, 'card:updated', { screenId: 2, card: null, revision: 7 }).revision).toBe(7);
		expect(createMessage(1, 'card:cleared', { screenId: 2, revision: 8 }).revision).toBe(8);
	});

	it('cannot be built without it', () => {
		expectTypeOf<{ screenId: number; card: null }>().not.toExtend<MessagePayload<'card:updated'>>();
		expectTypeOf<{ screenId: number }>().not.toExtend<MessagePayload<'card:cleared'>>();
	});
});
