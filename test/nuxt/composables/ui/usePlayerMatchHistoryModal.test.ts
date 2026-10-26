import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { deferred } from '~~/test/helpers/deferred';

const { mockFetch, modal, toast } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	modal: {
		open: vi.fn(),
		patch: vi.fn(),
	},
	toast: {
		add: vi.fn(),
	},
}));
const eventStore = reactive({ eventId: 1 as number | null });

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useOverlay', () => () => ({
	create: () => modal,
}));
mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('useToast', () => () => toast);

function player(id: number, name: string) {
	return { id, name } as never;
}

describe('usePlayerMatchHistoryModal', () => {
	beforeEach(() => {
		eventStore.eventId = 1;
	});

	it('opens loading, then shows the Player\'s match history from the Event', async () => {
		const history = [
			{ roundNumber: 1 },
		];
		mockFetch.mockResolvedValue({
			player: player(7, 'Alice (server)'),
			history,
		});

		await usePlayerMatchHistoryModal().openPlayerMatchHistory(player(7, 'Alice'));

		expect(modal.open).toHaveBeenCalledWith({
			player: player(7, 'Alice'),
			history: [],
			loading: true,
		});
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/7/match-history');
		expect(modal.patch).toHaveBeenCalledWith({
			player: player(7, 'Alice (server)'),
			history,
			loading: false,
		});
	});

	it('stops loading and says so when no Event is loaded', async () => {
		eventStore.eventId = null;

		await usePlayerMatchHistoryModal().openPlayerMatchHistory(player(7, 'Alice'));

		expect(mockFetch).not.toHaveBeenCalled();
		expect(modal.patch).toHaveBeenCalledWith({ loading: false });
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ description: 'No event loaded', color: 'error' }));
	});

	it('stops loading and says so when the history fails to load', async () => {
		mockFetch.mockRejectedValue(new Error('offline'));

		await usePlayerMatchHistoryModal().openPlayerMatchHistory(player(7, 'Alice'));

		expect(modal.patch).toHaveBeenCalledWith({ loading: false });
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ description: 'Failed to load match history', color: 'error' }));
	});

	it.each([
		[
			'answer',
			(pending: ReturnType<typeof deferred<unknown>>) => pending.resolve({
				player: player(7, 'Alice'),
				history: [],
			}),
		],
		[
			'failure',
			(pending: ReturnType<typeof deferred<unknown>>) => pending.reject(new Error('offline')),
		],
	])('drops a superseded request\'s %s once a later Player\'s opening overtook it', async (_, settle) => {
		const alice = deferred<unknown>();
		mockFetch.mockReturnValueOnce(alice.promise).mockResolvedValueOnce({
			player: player(8, 'Bob'),
			history: [],
		});
		const { openPlayerMatchHistory } = usePlayerMatchHistoryModal();

		const aliceOpening = openPlayerMatchHistory(player(7, 'Alice'));
		await openPlayerMatchHistory(player(8, 'Bob'));
		modal.patch.mockClear();
		settle(alice);
		await aliceOpening;

		expect(modal.patch).not.toHaveBeenCalled();
		expect(toast.add).not.toHaveBeenCalled();
	});
});
