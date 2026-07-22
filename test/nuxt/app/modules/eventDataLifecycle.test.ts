import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventDataLifecycle } from '~~/app/modules/event-data/lifecycle';

interface Item {
	id: number;
	eventId: number;
	roundId?: number;
	name: string;
}

function createHarness() {
	const repository = {
		list: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		remove: vi.fn(),
	};
	const onMutation = vi.fn();
	const onReset = vi.fn();
	const loadedRoundId = ref<number | null>(null);
	const lifecycle = useEventDataLifecycle<Item, { name: string }, { name: string }>({
		repository,
		entityLabel: 'Item',
		eventFilter: (item, currentEventId) => item.eventId === currentEventId,
		remoteScopeFilter: item => !loadedRoundId.value || item.roundId === loadedRoundId.value,
		onMutation,
		onReset,
	});

	return { repository, lifecycle, loadedRoundId, onMutation, onReset };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

describe('event data lifecycle module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('loads Event-scoped items and owns loaded state', async () => {
		const harness = createHarness();
		const data = [{ id: 1, eventId: 10, name: 'One' }];
		harness.repository.list.mockResolvedValue(data);

		await harness.lifecycle.loadByEventId(10);

		expect(harness.lifecycle.currentEventId.value).toBe(10);
		expect(harness.lifecycle.items.value).toEqual(data);
		expect(harness.lifecycle.isLoaded.value).toBe(true);
	});

	it('ignores a stale Event response that resolves after the active Event', async () => {
		const harness = createHarness();
		const first = deferred<Item[]>();
		const second = deferred<Item[]>();
		harness.repository.list
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		const firstLoad = harness.lifecycle.loadByEventId(10);
		const secondLoad = harness.lifecycle.loadByEventId(20);
		second.resolve([{ id: 2, eventId: 20, name: 'Current' }]);
		await secondLoad;
		first.resolve([{ id: 1, eventId: 10, name: 'Stale' }]);
		await firstLoad;

		expect(harness.lifecycle.currentEventId.value).toBe(20);
		expect(harness.lifecycle.items.value).toEqual([{ id: 2, eventId: 20, name: 'Current' }]);
	});

	it('invalidates an in-flight load when reset', async () => {
		const harness = createHarness();
		const pending = deferred<Item[]>();
		harness.repository.list.mockReturnValue(pending.promise);

		const load = harness.lifecycle.loadByEventId(10);
		harness.lifecycle.reset();
		pending.resolve([{ id: 1, eventId: 10, name: 'Stale' }]);
		await load;

		expect(harness.lifecycle.currentEventId.value).toBeNull();
		expect(harness.lifecycle.items.value).toEqual([]);
		expect(harness.lifecycle.hasFetched.value).toBe(false);
	});

	it('surfaces the latest load failure without marking the lifecycle loaded', async () => {
		const harness = createHarness();
		harness.repository.list.mockRejectedValue(new Error('Network unavailable'));

		await expect(harness.lifecycle.loadByEventId(10)).resolves.toBeNull();

		expect(harness.lifecycle.error.value).toBe('Network unavailable');
		expect(harness.lifecycle.hasFetched.value).toBe(false);
		expect(harness.lifecycle.listLoading.value).toBe(false);
	});

	it('creates, updates, and deletes through the lifecycle interface', async () => {
		const harness = createHarness();
		const item = { id: 1, eventId: 10, name: 'One' };
		harness.lifecycle.items.value = [item];
		harness.repository.create.mockResolvedValue({ id: 2, eventId: 10, name: 'Two' });
		harness.repository.update.mockResolvedValue({ ...item, name: 'Updated' });
		harness.repository.remove.mockResolvedValue({ success: true });

		await harness.lifecycle.create(10, { name: 'Two' });
		await harness.lifecycle.update(10, 1, { name: 'Updated' });
		await harness.lifecycle.remove(10, 2);

		expect(harness.lifecycle.items.value).toEqual([{ id: 1, eventId: 10, name: 'Updated' }]);
		expect(harness.onMutation).toHaveBeenCalledTimes(3);
	});

	it('creates and appends items through the lifecycle seam', async () => {
		const harness = createHarness();
		const created = { id: 2, eventId: 10, name: 'Two' };
		harness.repository.create.mockResolvedValue(created);

		await harness.lifecycle.create(10, { name: 'Two' });

		expect(harness.lifecycle.items.value).toEqual([created]);
		expect(harness.onMutation).toHaveBeenCalledOnce();
	});

	it('filters remote mutations by Event and loaded scope', () => {
		const harness = createHarness();
		harness.lifecycle.currentEventId.value = 10;
		harness.loadedRoundId.value = 5;

		harness.lifecycle.applyRemoteCreated({ id: 1, eventId: 99, roundId: 5, name: 'Wrong event' });
		harness.lifecycle.applyRemoteCreated({ id: 2, eventId: 10, roundId: 6, name: 'Wrong round' });
		harness.lifecycle.applyRemoteCreated({ id: 3, eventId: 10, roundId: 5, name: 'Right scope' });
		harness.lifecycle.applyRemoteUpdated({ id: 3, eventId: 10, roundId: 6, name: 'Stale update' });

		expect(harness.lifecycle.items.value).toEqual([{ id: 3, eventId: 10, roundId: 5, name: 'Right scope' }]);
		expect(harness.onMutation).toHaveBeenCalledOnce();
	});

	it('applies remote mutations', () => {
		const harness = createHarness();
		harness.lifecycle.currentEventId.value = 10;

		harness.lifecycle.applyRemoteCreated({ id: 2, eventId: 10, name: 'Right event' });
		harness.lifecycle.applyRemoteUpdated({ id: 2, eventId: 10, name: 'Updated' });
		harness.lifecycle.applyRemoteDeleted(2);

		expect(harness.lifecycle.items.value).toEqual([]);
		expect(harness.onMutation).toHaveBeenCalledTimes(3);
	});

	it('resets lifecycle state and calls reset hook', async () => {
		const harness = createHarness();
		harness.repository.list.mockResolvedValue([{ id: 1, eventId: 10, name: 'One' }]);
		await harness.lifecycle.loadByEventId(10);

		harness.lifecycle.reset();

		expect(harness.lifecycle.items.value).toEqual([]);
		expect(harness.lifecycle.currentEventId.value).toBeNull();
		expect(harness.lifecycle.isLoaded.value).toBe(false);
		expect(harness.onReset).toHaveBeenCalledOnce();
	});
});
