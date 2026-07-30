import type { GraphicsAuthoringLeaseRecord } from '~~/shared/modules/graphics-authoring-lease';
import { describe, expect, it } from 'vitest';
import {
	GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS,
	graphicsAuthoringArtifactKey,
	graphicsAuthoringLeaseDeadline,
	graphicsAuthoringLeaseTtlMs,
	resolveGraphicsAuthoringLease,
	screenEditWorkspaceArtifact,
} from '~~/shared/modules/graphics-authoring-lease';

const NOW = 1_000_000;

function held(overrides: Partial<GraphicsAuthoringLeaseRecord> = {}): GraphicsAuthoringLeaseRecord {
	return {
		holderSessionId: 'session-a',
		acquiredAt: NOW - 5_000,
		heartbeatAt: NOW - 1_000,
		expiresAt: NOW + 59_000,
		...overrides,
	};
}

describe('graphicsAuthoringLease artifacts', () => {
	it('addresses one Screen graphics Edit workspace', () => {
		expect(screenEditWorkspaceArtifact(7)).toEqual({ kind: 'screen-edit-workspace', id: '7' });
		expect(graphicsAuthoringArtifactKey(screenEditWorkspaceArtifact(7))).toBe('screen-edit-workspace:7');
	});
});

describe('graphicsAuthoringLease deadlines', () => {
	it('derives the deadline from the holder\'s declared heartbeat cadence', () => {
		expect(graphicsAuthoringLeaseTtlMs(GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS)).toBe(60_000);
		expect(graphicsAuthoringLeaseDeadline(NOW, 20_000)).toBe(NOW + 60_000);
	});

	it('clamps a declared cadence into the supported deadline range', () => {
		expect(graphicsAuthoringLeaseTtlMs(1)).toBe(3_000);
		expect(graphicsAuthoringLeaseTtlMs(10 * 60_000)).toBe(180_000);
		expect(graphicsAuthoringLeaseTtlMs(Number.NaN)).toBe(60_000);
	});
});

describe('resolveGraphicsAuthoringLease', () => {
	it('grants an unheld artifact to the asking session', () => {
		const resolution = resolveGraphicsAuthoringLease(undefined, { sessionId: 'session-a' }, NOW);

		expect(resolution.outcome).toBe('grant');
		expect(resolution.role).toBe('holder');
		expect(resolution.writable).toBe(true);
	});

	it('renews the deadline for the session that already holds it', () => {
		const resolution = resolveGraphicsAuthoringLease(held(), { sessionId: 'session-a' }, NOW);

		expect(resolution.outcome).toBe('renew');
		expect(resolution.role).toBe('holder');
		expect(resolution.writable).toBe(true);
	});

	it('makes another session a read-only observer while the lease is live', () => {
		const resolution = resolveGraphicsAuthoringLease(held(), { sessionId: 'session-b' }, NOW);

		expect(resolution.outcome).toBe('observe');
		expect(resolution.role).toBe('observer');
		expect(resolution.writable).toBe(false);
		expect(resolution.heldByAnotherSession).toBe(true);
	});

	it('hands a lapsed lease to the next asking session without a takeover', () => {
		const resolution = resolveGraphicsAuthoringLease(
			held({ expiresAt: NOW - 1 }),
			{ sessionId: 'session-b' },
			NOW,
		);

		expect(resolution.outcome).toBe('grant');
		expect(resolution.role).toBe('holder');
	});

	it('takes a live lease over only when the takeover is explicit', () => {
		const resolution = resolveGraphicsAuthoringLease(
			held(),
			{ sessionId: 'session-b', takeover: true },
			NOW,
		);

		expect(resolution.outcome).toBe('takeover');
		expect(resolution.role).toBe('holder');
		expect(resolution.writable).toBe(true);
	});

	it('treats a takeover of the session\'s own lease as an ordinary renewal', () => {
		const resolution = resolveGraphicsAuthoringLease(
			held(),
			{ sessionId: 'session-a', takeover: true },
			NOW,
		);

		expect(resolution.outcome).toBe('renew');
	});

	it('leaves a session without any identity read-only against a live lease', () => {
		const resolution = resolveGraphicsAuthoringLease(held(), { sessionId: undefined }, NOW);

		expect(resolution.writable).toBe(false);
		expect(resolution.heldByAnotherSession).toBe(true);
	});

	it('lets a session without any identity write an unheld artifact', () => {
		const resolution = resolveGraphicsAuthoringLease(undefined, { sessionId: undefined }, NOW);

		expect(resolution.writable).toBe(true);
		expect(resolution.heldByAnotherSession).toBe(false);
	});
});
