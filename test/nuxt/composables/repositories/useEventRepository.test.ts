import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

const mockFetch = vi.fn();
const mockAbly = createMockRealtime();

const mockBase = vi.hoisted(() => ({
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));

vi.mock('~/modules/event-data/client', async importOriginal => ({
	...(await importOriginal<typeof import('~~/app/modules/event-data/client')>()),
	useEventDataResource: () => mockBase,
}));

vi.stubGlobal('$fetch', mockFetch);
mockNuxtImport('useRealtime', () => () => mockAbly);

describe('useEventRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('lists events with custom $fetch', async () => {
		const events = [{ id: 1, name: 'Event 1' }];
		mockFetch.mockResolvedValue({ events, total: 1 });
		const repo = useEventRepository();

		const result = await repo.list();
		expect(result).toEqual(events);
		expect(mockFetch).toHaveBeenCalledWith('/api/events', expect.objectContaining({}));
	});

	it('lists events with game filter', async () => {
		mockFetch.mockResolvedValue({ events: [], total: 0 });
		const repo = useEventRepository();

		await repo.list({ game: 'mtg' as any });
		expect(mockFetch).toHaveBeenCalledWith('/api/events', expect.objectContaining({
			query: { game: 'mtg' },
		}));
	});

	it('delegates getById to base repository', async () => {
		mockBase.getById.mockResolvedValue({ id: 1 });
		const repo = useEventRepository();

		await repo.getById(1);
		expect(mockBase.getById).toHaveBeenCalledWith(null, 1);
	});

	it('creates event with custom $fetch (no headers)', async () => {
		const eventData = { name: 'New Event' };
		mockFetch.mockResolvedValue({ id: 1, ...eventData });
		const repo = useEventRepository();

		await repo.create(eventData as any);
		expect(mockFetch).toHaveBeenCalledWith('/api/events', expect.objectContaining({
			method: 'POST',
			body: eventData,
		}));
	});

	it('delegates update to base repository', async () => {
		mockBase.update.mockResolvedValue({ id: 1 });
		const repo = useEventRepository();

		await repo.update(1, { name: 'Updated' } as any);
		expect(mockBase.update).toHaveBeenCalledWith(null, 1, { name: 'Updated' });
	});

	it('delegates remove to base repository', async () => {
		mockBase.remove.mockResolvedValue({ success: true });
		const repo = useEventRepository();

		await repo.remove(1);
		expect(mockBase.remove).toHaveBeenCalledWith(null, 1);
	});

	it('syncs melee with POST', async () => {
		mockFetch.mockResolvedValue({ success: true, message: 'ok' });
		const repo = useEventRepository();

		await repo.syncMelee(1);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/melee/sync-event', expect.objectContaining({
			method: 'POST',
		}));
	});

	it('runs initial setup through one canonical POST endpoint', async () => {
		mockFetch.mockResolvedValue({ success: true, message: 'ok' });
		const repo = useEventRepository();

		await repo.runInitialSetup(1);

		expect(mockFetch).toHaveBeenCalledOnce();
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/melee/initial-setup', expect.objectContaining({
			method: 'POST',
		}));
		expect(repo).not.toHaveProperty('resyncMatches');
		expect(repo).not.toHaveProperty('syncAllRounds');
	});

	it('preserves warning arrays from every first-party Melee sync command', async () => {
		const warnings = ['Data was saved, but a realtime notification could not be delivered'];
		mockFetch.mockResolvedValue({ success: true, warnings });
		const repo = useEventRepository();

		const responses = await Promise.all([
			repo.syncMelee(1),
			repo.runInitialSetup(1),
			repo.syncPlayers(1),
			repo.syncSpecificRound(1, 2),
			repo.updateFromMelee(1),
			repo.syncDecklists(1),
		]);

		for (const response of responses)
			expect(response.warnings).toEqual(warnings);
	});
});
