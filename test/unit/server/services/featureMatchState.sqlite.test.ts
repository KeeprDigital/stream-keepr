import type { DbFeatureMatch, DbPlayer } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '~~/shared/types/featureMatchDefaults';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Feature Match Session service over real SQL: source snapshots, command
// admission and receipts, merges onto an advanced Session, and the open that
// loses a race adopting the Session that won it.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

/** Run once, just before or straight after the next batch commits: the other side of a race. */
let beforeNextBatch: (() => Promise<void>) | undefined;
let afterNextBatch: (() => Promise<void>) | undefined;
const racingDb = new Proxy(db, {
	get(target, property, receiver) {
		if (property === 'batch') {
			return async (queries: Parameters<typeof db.batch>[0]) => {
				const first = beforeNextBatch;
				beforeNextBatch = undefined;
				await first?.();
				const result = await target.batch(queries);
				const race = afterNextBatch;
				afterNextBatch = undefined;
				await race?.();
				return result;
			};
		}
		const value = Reflect.get(target, property, receiver);
		return typeof value === 'function'
			? value.bind(target)
			: value;
	},
});

const publishMessage = vi.fn(async (..._args: unknown[]) => {});

vi.doMock('~~/server/db', () => ({ db: racingDb }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	publishMessageStrict: publishMessage,
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

beforeEach(() => {
	publishMessage.mockClear();
	beforeNextBatch = undefined;
	afterNextBatch = undefined;
});

afterAll(async () => await harness.close());

const defaults = { ...DEFAULT_FEATURE_MATCH_DEFAULTS, game: 'mtg' as const };

async function stageSlot(values: Partial<typeof schema.featureMatches.$inferInsert> = {}) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const [slot] = await db.insert(schema.featureMatches)
		.values({ eventId: event!.id, tableNumber: 12, ...values })
		.returning();
	return slot!;
}

async function openSession() {
	const slot = await stageSlot();
	const session = (await featureMatchStateService().createSessionForSlot(slot.id, slot.eventId))!;
	return { slot, session };
}

function announced(eventType: string) {
	return publishMessage.mock.calls
		.filter(([, type, payload]) => type === 'featureMatchSession:eventApplied' && (payload as { eventType: string }).eventType === eventType)
		.map(([, , payload]) => payload as { sessionId: number });
}

describe('buildSourceSnapshot', () => {
	it('takes Player records, Event defaults and the Slot\'s display overrides together', async () => {
		const slot = await stageSlot();
		const [alice, bob] = await db.insert(schema.players)
			.values([
				{
					eventId: slot.eventId,
					name: 'Alice',
					wins: 3,
					losses: 1,
					gameData: { type: 'mtg', deckName: 'Control' },
				},
				{ eventId: slot.eventId, name: 'Bob', points: 6 },
			])
			.returning();
		const withPlayers: DbFeatureMatch = {
			...slot,
			player1Id: alice!.id,
			player1Data: {
				name: 'Display Alice',
				deckId: 77,
				gameData: { type: 'mtg', deckName: 'Aggro' },
			},
			player2Id: bob!.id,
		};

		const snapshot = await featureMatchStateService().buildSourceSnapshot(withPlayers, { ...defaults, startingLife: 25 });

		expect(snapshot).toMatchObject({
			eventId: slot.eventId,
			slotId: slot.id,
			tableNumber: 12,
			defaults: expect.objectContaining({ startingLife: 25 }),
			player1: {
				playerId: alice!.id,
				data: expect.objectContaining({
					name: 'Display Alice',
					deckId: 77,
					wins: 3,
					gameData: { type: 'mtg', deckName: 'Aggro' },
				}),
			},
			player2: {
				playerId: bob!.id,
				data: expect.objectContaining({ name: 'Bob', points: 6 }),
			},
		});
	});

	it('stamps a snapshot with the moment it was built', async () => {
		const slot = await stageSlot();
		vi.useFakeTimers({
			toFake: ['Date'],
		});
		vi.setSystemTime(Date.parse('2026-03-04T05:06:07.000Z'));
		try {
			expect((await featureMatchStateService().buildSourceSnapshot(slot, defaults)).createdAt)
				.toBe(Date.parse('2026-03-04T05:06:07.000Z'));
		}
		finally {
			vi.useRealTimers();
		}
	});

	it.each([
		[
			'with display fields',
			{ name: 'Alice' },
		],
		['without display fields', {}],
	])('keeps a Slot\'s explicit no-deck identity %s rather than the Player\'s primary deck', async (_case, display) => {
		const slot = await stageSlot();
		const player = {
			id: 101,
			eventId: slot.eventId,
			name: 'Alice',
			archetypeId: 9,
			gameData: { type: 'mtg', deckName: 'Primary Deck', deckColors: 'R' },
		} as DbPlayer;
		const noDeck = {
			...display,
			deckId: null,
			archetypeId: null,
			gameData: { type: 'mtg' as const, deckName: null, deckColors: null },
		};

		const snapshot = await featureMatchStateService().buildSourceSnapshot(
			{ ...slot, player1Id: 101, player1Data: noDeck },
			defaults,
			new Map([
				[101, player],
			]),
		);

		expect(snapshot.player1.data).toEqual(expect.objectContaining({
			name: 'Alice',
			deckId: null,
			archetypeId: null,
			gameData: noDeck.gameData,
		}));
	});
});

describe('applyCommand', () => {
	it('merges a relative command onto a Session that advanced past its base', async () => {
		const { slot, session } = await openSession();
		await featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'a',
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -5 },
			baseSequence: session.sequence,
		});

		const result = await featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'b',
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -1 },
			baseSequence: session.sequence,
		});

		expect(result.sequence).toBe(session.sequence + 2);
		expect(result.currentState.player1.lifeTotal).toBe(session.currentState.player1.lifeTotal - 6);
	});

	it('retries a relative command whose commit lost a race, merging onto the Session as it then stands', async () => {
		const { slot, session } = await openSession();
		beforeNextBatch = async () => {
			await featureMatchStateService().applyCommand(session.id, slot.eventId, {
				commandId: 'other',
				type: 'AdjustLife',
				payload: { player: 'player1', delta: -5 },
				baseSequence: session.sequence,
			});
		};

		const result = await featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'mine',
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -1 },
			baseSequence: session.sequence,
		});

		expect(result.sequence).toBe(session.sequence + 2);
		expect(result.currentState.player1.lifeTotal).toBe(session.currentState.player1.lifeTotal - 6);
	});

	it('refuses an absolute command whose base the Session has moved past', async () => {
		const { slot, session } = await openSession();
		await featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'a',
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -5 },
			baseSequence: session.sequence,
		});

		await expect(featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'b',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 30 },
			baseSequence: session.sequence,
		}))
			.rejects
			.toMatchObject({ statusCode: 409, message: 'Feature match session has advanced' });
	});

	it('re-reduces a snapshot correction onto a Session an operator advanced under it', async () => {
		const { slot, session } = await openSession();
		await featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'a',
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -5 },
			baseSequence: session.sequence,
		});
		const corrected = {
			...session.sourceSnapshot,
			player1: {
				playerId: null,
				data: { name: 'Renamed Alice' },
			},
		};

		const result = await featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'b',
			type: 'SnapshotCorrected',
			payload: { sourceSnapshot: corrected },
			baseSequence: session.sequence,
		});

		expect(result.sourceSnapshot.player1.data?.name).toBe('Renamed Alice');
		expect(result.currentState.player1.lifeTotal).toBe(session.currentState.player1.lifeTotal - 5);
	});

	it('refuses a snapshot correction for another Event or Slot', async () => {
		const { slot, session } = await openSession();

		await expect(featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'wrong-snapshot',
			type: 'SnapshotCorrected',
			payload: {
				sourceSnapshot: { ...session.sourceSnapshot, slotId: slot.id + 1_000 },
			},
			baseSequence: session.sequence,
		})).rejects.toMatchObject({ statusCode: 400, message: 'Snapshot correction does not belong to this session' });
	});

	it('answers a retried command with the Session as it stands, and refuses its id for a different command', async () => {
		const { slot, session } = await openSession();
		const start = {
			commandId: 'clock',
			type: 'StartClock' as const,
			payload: {},
			baseSequence: session.sequence,
		};
		const first = await featureMatchStateService().applyCommand(session.id, slot.eventId, start);

		const retried = await featureMatchStateService().applyCommand(session.id, slot.eventId, start);

		expect(retried.sequence).toBe(first.sequence);
		await expect(featureMatchStateService().applyCommand(session.id, slot.eventId, {
			...start,
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 11 },
		}))
			.rejects
			.toMatchObject({ statusCode: 409, message: 'commandId has already been used for a different command' });
	});

	it('announces an applied command when asked, without the Session response', async () => {
		const { slot, session } = await openSession();
		publishMessage.mockClear();

		const result = await featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'a',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 12 },
			baseSequence: session.sequence,
		}, 'origin-1', { publish: true });

		expect(publishMessage).toHaveBeenCalledWith(slot.eventId, 'featureMatchSession:eventApplied', {
			slotId: slot.id,
			sessionId: session.id,
			sequence: result.sequence,
			eventType: 'SetLife',
			sourceSnapshot: result.sourceSnapshot,
			currentState: result.currentState,
		}, 'origin-1');
	});

	it('stays silent when not asked to announce', async () => {
		const { slot, session } = await openSession();
		publishMessage.mockClear();

		await featureMatchStateService().applyCommand(session.id, slot.eventId, {
			commandId: 'a',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 12 },
			baseSequence: session.sequence,
		});

		expect(publishMessage).not.toHaveBeenCalled();
	});
});

describe('an open that loses a race', () => {
	/** The Slot's one active Session, after checking the race did open a second. */
	async function activeSessionId(slot: DbFeatureMatch) {
		const sessions = await db.query.featureMatchSessions.findMany({
			where: eq(schema.featureMatchSessions.slotId, slot.id),
		});
		expect(sessions).toHaveLength(2);
		const active = sessions.filter(session => session.status === 'active');
		expect(active).toHaveLength(1);
		return active[0]!.id;
	}

	it('answers with, and announces, the Session the Slot ended up owning', async () => {
		const slot = await stageSlot();
		afterNextBatch = async () => {
			await featureMatchStateService().createSessionForSlot(slot.id, slot.eventId);
		};

		const result = await featureMatchStateService().createSessionForSlot(slot.id, slot.eventId);

		const winnerId = await activeSessionId(slot);
		expect(result?.id).toBe(winnerId);
		expect(announced('SessionStarted').map(payload => payload.sessionId)).toEqual([winnerId, winnerId]);
	});

	it('applies a reverse-sync command to the Session that won', async () => {
		const slot = await stageSlot();
		afterNextBatch = async () => {
			await featureMatchStateService().createSessionForSlot(slot.id, slot.eventId);
		};
		const createCommand = vi.fn((session: { id: number; sequence: number; sourceSnapshot: object }) => ({
			commandId: 'reverse-sync',
			type: 'SnapshotCorrected' as const,
			payload: { sourceSnapshot: session.sourceSnapshot as never },
			baseSequence: session.sequence,
		}));

		const result = await featureMatchStateService().applyCommandToActiveSession(slot.id, slot.eventId, createCommand);

		const winnerId = await activeSessionId(slot);
		expect(createCommand).toHaveBeenCalledWith(expect.objectContaining({ id: winnerId }));
		expect(result?.sessionId).toBe(winnerId);
	});
});
