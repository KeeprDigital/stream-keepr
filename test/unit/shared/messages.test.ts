import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { MessagePayload } from '~~/shared/types/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';
import { createMessage } from '~~/shared/types/messages';

describe('createMessage', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
	});

	it('creates a message with eventId and timestamp', () => {
		const payload = {
			event: { id: 1, name: 'Test' },
		} satisfies MessagePayload<'event:updated'>;
		const msg = createMessage(1, 'event:updated', payload);
		expect(msg.eventId).toBe(1);
		expect(msg.timestamp).toBe(Date.now());
	});

	it('spreads payload into the message', () => {
		const payload = {
			event: { id: 5, name: 'Test' },
		} satisfies MessagePayload<'event:updated'>;
		const msg = createMessage(1, 'event:updated', payload);
		expect(msg).toHaveProperty('event');
		expect(msg.event.id).toBe(5);
	});

	it('includes originConnectionId when provided', () => {
		const msg = createMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123');
		expect(msg.originConnectionId).toBe('conn-123');
	});

	it('leaves originConnectionId undefined when not provided', () => {
		const msg = createMessage(1, 'event:deleted', { eventId: 1 });
		expect(msg.originConnectionId).toBeUndefined();
	});

	it('handles messages with complex payloads', () => {
		const sourceSnapshot = {
			eventId: 1,
			slotId: 42,
			matchId: null,
			externalId: null,
			externalSource: null,
			tableNumber: null,
			bestOf: 3,
			playerDisplayMode: 'score',
			game: 'mtg',
			defaults: toFeatureMatchDefaults(null),
			player1: { playerId: null, data: null },
			player2: { playerId: null, data: null },
			createdAt: Date.now(),
		} satisfies FeatureMatchSourceSnapshot;
		const msg = createMessage(1, 'featureMatchSession:eventApplied', {
			slotId: 42,
			sessionId: 7,
			sequence: 2,
			eventType: 'SetTurnNumber',
			sourceSnapshot,
			currentState: createInitialFeatureMatchState(),
		});
		expect(msg.slotId).toBe(42);
		expect(msg.currentState.currentGame).toBe(1);
	});

	it('handles undefined payload gracefully', () => {
		const msg = createMessage(1, 'event:deleted');
		expect(msg.eventId).toBe(1);
		expect(msg.timestamp).toBeTypeOf('number');
	});

	afterEach(() => {
		vi.useRealTimers();
	});
});

/**
 * A Card announcement carries the Card revision its write committed, which
 * every holder orders Card states by (#734). Typecheck fails here if
 * `card:updated` or `card:cleared` stops requiring it.
 */
describe('the Card announcements', () => {
	it('carry the Card revision', () => {
		const updated = createMessage(1, 'card:updated', { screenId: 2, card: null, revision: 7 });
		const cleared = createMessage(1, 'card:cleared', { screenId: 2, revision: 8 });

		expect(updated.revision).toBe(7);
		expect(cleared.revision).toBe(8);
	});

	it('cannot be built without it', () => {
		// @ts-expect-error — a Card update with no revision to order it by
		const updated = { screenId: 2, card: null } satisfies MessagePayload<'card:updated'>;
		// @ts-expect-error — a Card Clear with no revision to order it by
		const cleared = { screenId: 2 } satisfies MessagePayload<'card:cleared'>;

		expect(updated).not.toHaveProperty('revision');
		expect(cleared).not.toHaveProperty('revision');
	});
});
