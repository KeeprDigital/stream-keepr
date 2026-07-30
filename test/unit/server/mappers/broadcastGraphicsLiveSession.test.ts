import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import { describe, expect, it } from 'vitest';
import {
	mapBroadcastGraphicsCommandResult,
	mapBroadcastGraphicsLiveSessionToResponse,
} from '~~/server/mappers/broadcastGraphicsLiveSession';

/**
 * Every read of a Broadcast Graphics Live Session passes through this mapper — the
 * snapshot route, every command result, and the realtime notification derived from
 * one. So it is the one place where durable live state stops being raw JSON from a
 * text column and becomes something a Live Control or a Screen Output may act on,
 * and therefore the place where "unreadable live state renders every output
 * transparent" is either true of every path or of none.
 *
 * This is also the seam at which a corrupt state can be tested at all. Nothing in
 * the product writes one, so the HTTP command surface cannot produce the case; the
 * durable row can, and this is the function that reads it.
 */
function row(currentState: unknown): DbBroadcastGraphicsLiveSession {
	return {
		id: 12,
		eventId: 3,
		screenId: 7,
		status: 'active',
		currentState,
		sequence: 4,
		endedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	} as DbBroadcastGraphicsLiveSession;
}

describe('mapBroadcastGraphicsLiveSessionToResponse', () => {
	it('reports no fault and passes live state through when it reads normally', () => {
		const state = {
			playout: { slate: { onAir: true } },
			inputs: { slate: { working: { name: 'Ava' }, accepted: { name: 'Ava' }, acceptedRevision: 1 } },
		};

		const mapped = mapBroadcastGraphicsLiveSessionToResponse(row(state));

		expect(mapped.recoveryFault).toBeNull();
		expect(mapped.currentState).toEqual(state);
	});

	it('replaces live state it cannot read with one that has nothing on air', () => {
		const mapped = mapBroadcastGraphicsLiveSessionToResponse(row({ playout: { slate: 'yes' }, inputs: {} }));

		expect(mapped.recoveryFault?.reason).toBe('corrupt');
		expect(mapped.currentState).toEqual({ playout: {}, inputs: {} });
	});

	it('reports a missing live state rather than answering with an empty one silently', () => {
		// Silently answering "nothing is on air" would be indistinguishable from a show
		// that has not started, so an operator would have no reason to look further.
		const mapped = mapBroadcastGraphicsLiveSessionToResponse(row(null));

		expect(mapped.recoveryFault?.reason).toBe('missing');
		expect(mapped.currentState).toEqual({ playout: {}, inputs: {} });
	});

	it('keeps the epoch’s own identity and sequence, which the fault does not invalidate', () => {
		// The session is still the Screen's current epoch: commands still name it, and
		// the next accepted one is what writes a state that can be read.
		const mapped = mapBroadcastGraphicsLiveSessionToResponse(row('not live state at all'));

		expect(mapped.id).toBe(12);
		expect(mapped.sequence).toBe(4);
		expect(mapped.status).toBe('active');
	});
});

describe('mapBroadcastGraphicsCommandResult', () => {
	it('answers with the same recovered state on both halves of the result', () => {
		// `currentState` is what a peer applies in place off the realtime notification;
		// `session` is what the caller caches. Deriving them separately lets a peer be
		// handed a recovered snapshot alongside the raw unreadable state and apply the
		// latter as authoritative — so this is the invariant, not an implementation
		// detail: whatever a reader is told is on air must be one answer.
		const result = mapBroadcastGraphicsCommandResult(row({ playout: { slate: 'yes' }, inputs: {} }), 'Take');

		expect(result.currentState).toEqual(result.session.currentState);
		expect(result.currentState).toEqual({ playout: {}, inputs: {} });
		expect(result.session.recoveryFault?.reason).toBe('corrupt');
	});

	it('carries the epoch identity, sequence, and command the caller needs to correlate it', () => {
		const result = mapBroadcastGraphicsCommandResult(
			row({ playout: { slate: { onAir: true } }, inputs: {} }),
			'Out',
		);

		expect(result).toMatchObject({ screenId: 7, sessionId: 12, sequence: 4, commandType: 'Out' });
		expect(result.currentState.playout.slate).toEqual({ onAir: true });
		expect(result.session.recoveryFault).toBeNull();
	});
});
