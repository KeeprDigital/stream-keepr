import { describe, expect, it } from 'vitest';
import {
	createMockEvent,
	createMockRound,
	createWireMockArchetype,
	createWireMockEvent,
	createWireMockFeatureMatch,
	createWireMockMatch,
	createWireMockPhase,
	createWireMockPlayer,
	createWireMockPlayerList,
	createWireMockPlayerListMember,
	createWireMockPlayerRoundStandings,
	createWireMockRound,
	createWireMockScreen,
	createWireMockTalent,
	createWireMockUiArchetype,
	toWire,
} from '~~/test/helpers/fixtures';

/**
 * The wire factories' own shape test.
 *
 * A fixture helper whose whole purpose is a shape has to have that shape asserted
 * somewhere, or the next hand-written sibling quietly reintroduces the `Date` it
 * exists to remove — and every suite that adopted it would go on passing while
 * standing in for a wire read with server truth again (#296, #284, #272).
 */
describe('wire-shaped fixtures', () => {
	const wireFactories = {
		createWireMockEvent,
		createWireMockTalent,
		createWireMockPlayer,
		createWireMockArchetype,
		createWireMockUiArchetype,
		createWireMockPlayerList,
		createWireMockPlayerListMember,
		createWireMockFeatureMatch,
		createWireMockScreen,
		createWireMockPlayerRoundStandings,
		createWireMockPhase,
		createWireMockRound,
		createWireMockMatch,
	} as const;

	it.each(Object.entries(wireFactories))('%s carries no Date at all', (_name, factory) => {
		const row = factory() as Record<string, unknown>;

		// Named before it is read: an empty row would satisfy every assertion below.
		expect(Object.keys(row).length).toBeGreaterThan(3);
		for (const [field, value] of Object.entries(row))
			expect({ field, isDate: value instanceof Date }).toEqual({ field, isDate: false });
		expect(row.createdAt).toBe('2026-01-01T00:00:00.000Z');
		expect(row.updatedAt).toBe('2026-01-01T00:00:00.000Z');
	});

	it('turns an overridden Date into the string the wire would carry', () => {
		const wire = createWireMockRound({ lastSyncedAt: new Date('2026-04-09T10:00:00.000Z') });

		expect(wire.lastSyncedAt).toBe('2026-04-09T10:00:00.000Z');
		expect(typeof wire.lastSyncedAt).toBe('string');
	});

	it('leaves a null timestamp null rather than stringifying it', () => {
		// `JSON.stringify(null)` is the string 'null', which would read as a synced round
		// forever — the badge is rendered on truthiness (#291).
		expect(createWireMockRound().lastSyncedAt).toBeNull();
		expect(createWireMockEvent().lastEventSyncedAt).toBeNull();
	});

	it('changes nothing but the timestamps', () => {
		const round = createMockRound({ id: 7, name: 'Round 7', externalSource: 'melee' });
		const wire = createWireMockRound({ id: 7, name: 'Round 7', externalSource: 'melee' });

		expect({ ...wire, createdAt: null, updatedAt: null })
			.toEqual({ ...round, createdAt: null, updatedAt: null });
	});

	it('round-trips a fixture built anywhere else', () => {
		// The escape hatch: a suite's own literal or a store's seeded state asks the same
		// question, and hand-rolling `JSON.parse(JSON.stringify(...))` per suite is how the
		// shape drifts between them.
		const wire = toWire({ event: createMockEvent({ lastEventSyncedAt: new Date('2026-04-09T10:05:00.000Z') }) });

		expect(wire.event.lastEventSyncedAt).toBe('2026-04-09T10:05:00.000Z');
		expect(wire.event.createdAt).toBe('2026-01-01T00:00:00.000Z');
	});
});
