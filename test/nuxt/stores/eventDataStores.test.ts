import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPhase, createMockRound } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

/*
 * The Phase and Round stores are configuration over the Event Data lifecycle, whose
 * behaviour test/nuxt/app/modules/eventDataLifecycle.test.ts owns. These rows pin only
 * each store's own configuration: its Event filter and its realtime wiring.
 */

const mockRepo = vi.hoisted(() => ({
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));

vi.mock('~/modules/event-data/client', async importOriginal => ({
	...(await importOriginal<typeof import('~~/app/modules/event-data/client')>()),
	useEventDataResource: () => mockRepo,
}));

const { deliver } = realtimeHandlersFor();

const stores = [
	{
		name: 'Phase',
		store: () => {
			const store = usePhaseStore();
			return {
				load: store.loadPhasesByEventId,
				update: store.updatePhase,
				items: () => store.phases,
				store,
			};
		},
		entity: createMockPhase,
		created: (phase: ReturnType<typeof createMockPhase>) => deliver('phase:created', { phase } as never),
		updated: (phase: ReturnType<typeof createMockPhase>) => deliver('phase:updated', { phase } as never),
		deleted: (phaseId: number) => deliver('phase:deleted', { phaseId } as never),
	},
	{
		name: 'Round',
		store: () => {
			const store = useRoundStore();
			return {
				load: store.loadRoundsByEventId,
				update: store.updateRound,
				items: () => store.rounds,
				store,
			};
		},
		entity: createMockRound,
		created: (round: ReturnType<typeof createMockRound>) => deliver('round:created', { round } as never),
		updated: (round: ReturnType<typeof createMockRound>) => deliver('round:updated', { round } as never),
		deleted: (roundId: number) => deliver('round:deleted', { roundId } as never),
	},
];

describe.each(stores)('the $name store', ({ store: useStore, entity, created, updated, deleted }) => {
	let subject: ReturnType<typeof useStore>;

	beforeEach(async () => {
		subject = useStore();
		subject.store.$reset();
		mockRepo.list.mockResolvedValue([]);
		await subject.load(1);
	});

	it('applies a peer\'s create, update and delete for its Event, and keeps another Event\'s out', () => {
		created(entity({ id: 10, eventId: 999 }) as never);
		created(entity({ id: 11, eventId: 1, name: 'Before' }) as never);
		updated(entity({ id: 11, eventId: 1, name: 'After' }) as never);

		expect(subject.items().map(item => [item.id, item.name])).toEqual([
			[11, 'After'],
		]);

		deleted(11);

		expect(subject.items()).toEqual([]);
	});

	it('reports the server\'s sentence for a refused update and rolls it back', async () => {
		created(entity({ id: 1, eventId: 1, name: 'Before' }) as never);
		mockRepo.update.mockRejectedValue(transportFailure({
			status: 409,
			body: { message: 'It has already started' },
		}));

		await subject.update(1, 1, { name: 'After' });

		expect(subject.store.error).toBe('It has already started');
		expect(subject.items()[0]!.name).toBe('Before');
	});
});

it('ignores this client\'s own Event Data messages, which it already applied', async () => {
	const store = useRoundStore();
	store.$reset();
	mockRepo.list.mockResolvedValue([]);
	await store.loadRoundsByEventId(1);
	const held = createMockRound({ id: 10, eventId: 1, name: 'Held' });
	store.rounds = [held];

	deliver('round:created', {
		round: createMockRound({ id: 11, eventId: 1 }),
	} as never, { fromSelf: true });
	deliver('round:updated', {
		round: { ...held, name: 'Changed' },
	} as never, { fromSelf: true });
	deliver('round:deleted', { roundId: 10 }, { fromSelf: true });

	expect(store.rounds).toEqual([held]);
});
