import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

const { toast } = vi.hoisted(() => ({
	toast: {
		add: vi.fn(),
	},
}));

const allScreens = [
	{ id: 1, name: 'Main', currentMode: 'standings' },
	{ id: 2, name: 'History A', currentMode: 'player-history' },
	{ id: 3, name: 'History B', currentMode: 'player-history' },
];
const screenStore = reactive({
	screens: allScreens,
	updateModeConfig: vi.fn(),
});
const eventStore = reactive({ eventId: 1 as number | null });

mockNuxtImport('useScreenStore', () => () => screenStore);
mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('useToast', () => () => toast);

describe('useSendPlayerHistoryToScreen', () => {
	beforeEach(() => {
		eventStore.eventId = 1;
		screenStore.screens = allScreens;
		screenStore.updateModeConfig.mockResolvedValue(undefined);
	});

	it('offers only the Screens in Player History mode', () => {
		const { playerHistoryScreens, hasPlayerHistoryScreens } = useSendPlayerHistoryToScreen();

		expect(playerHistoryScreens.value.map(screen => screen.id)).toEqual([2, 3]);
		expect(hasPlayerHistoryScreens.value).toBe(true);
	});

	it('points a Screen at the Player from its first page and confirms it', async () => {
		const { sendToScreen } = useSendPlayerHistoryToScreen();

		await expect(sendToScreen(42, allScreens[2] as never)).resolves.toBe(true);

		expect(screenStore.updateModeConfig).toHaveBeenCalledWith(1, 3, 'player-history', { playerId: 42, currentPage: 1 });
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Match history sent', color: 'success' }));
	});

	it('reports a refused send as not sent', async () => {
		screenStore.updateModeConfig.mockRejectedValue(new Error('refused'));

		await expect(useSendPlayerHistoryToScreen().sendToScreen(42, allScreens[1] as never)).resolves.toBe(false);
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
	});

	it('sends nothing without an Event', async () => {
		eventStore.eventId = null;

		await expect(useSendPlayerHistoryToScreen().sendToScreen(42, allScreens[1] as never)).resolves.toBe(false);
		expect(screenStore.updateModeConfig).not.toHaveBeenCalled();
	});

	it('sends to the first Player History Screen', async () => {
		await expect(useSendPlayerHistoryToScreen().sendToFirstPlayerHistoryScreen(42)).resolves.toBe(true);

		expect(screenStore.updateModeConfig).toHaveBeenCalledWith(1, 2, 'player-history', { playerId: 42, currentPage: 1 });
	});

	it('warns instead of sending when no Screen is in Player History mode', async () => {
		screenStore.screens = [allScreens[0]!];

		await expect(useSendPlayerHistoryToScreen().sendToFirstPlayerHistoryScreen(42)).resolves.toBe(false);
		expect(screenStore.updateModeConfig).not.toHaveBeenCalled();
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'No Player History Screen', color: 'warning' }));
	});
});
