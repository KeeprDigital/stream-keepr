import type { DbFeatureMatchSession } from '~~/server/db/schema';
import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import { describe, expect, it } from 'vitest';
import { mapFeatureMatchSessionToStarted, mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';

function session(overrides?: Partial<DbFeatureMatchSession>): DbFeatureMatchSession {
	return {
		id: 30,
		eventId: 1,
		slotId: 7,
		status: 'active',
		sourceSnapshot: {
			player1: { id: 100 },
		} as unknown as FeatureMatchSourceSnapshot,
		currentState: createMockFeatureMatchState(),
		sequence: 4,
		closedAt: null,
		createdAt: '2026-03-10T08:00:00.000Z' as unknown as Date,
		updatedAt: '2026-03-10T09:00:00.000Z' as unknown as Date,
		...overrides,
	};
}

describe('feature match mapper', () => {
	it('maps a Slot with no active Session to a null activeSession', () => {
		expect(mapFeatureMatchToResponse(createMockFeatureMatch()).activeSession).toBeNull();
		expect(mapFeatureMatchToResponse({
			...createMockFeatureMatch(),
			activeSession: null,
		}).activeSession).toBeNull();
	});

	it('maps a Slot\'s active Session, timestamps included', () => {
		const active = session();
		const response = mapFeatureMatchToResponse({
			...createMockFeatureMatch({ id: 7 }),
			activeSession: active,
		});

		expect(response.activeSession).toMatchObject({
			id: 30,
			slotId: 7,
			sequence: 4,
			currentState: active.currentState,
			sourceSnapshot: active.sourceSnapshot,
		});
		expect(response.activeSession?.createdAt).toEqual(new Date('2026-03-10T08:00:00.000Z'));
	});

	it('announces a new Session as SessionStarted carrying its whole snapshot (ADR-0026)', () => {
		const started = session();

		expect(mapFeatureMatchSessionToStarted(started)).toEqual({
			slotId: 7,
			sessionId: 30,
			sequence: 4,
			eventType: 'SessionStarted',
			sourceSnapshot: started.sourceSnapshot,
			currentState: started.currentState,
		});
	});
});
