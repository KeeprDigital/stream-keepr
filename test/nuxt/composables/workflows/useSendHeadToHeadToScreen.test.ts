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
	{ id: 2, name: 'H2H A', currentMode: 'head-to-head' },
	{ id: 3, name: 'H2H B', currentMode: 'head-to-head' },
];
const screenStore = reactive({
	screens: allScreens,
	updateModeConfig: vi.fn(),
});
const eventStore = reactive({ eventId: 1 as number | null });

mockNuxtImport('useScreenStore', () => () => screenStore);
mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('useToast', () => () => toast);

describe('useSendHeadToHeadToScreen', () => {
	beforeEach(() => {
		eventStore.eventId = 1;
		screenStore.screens = allScreens;
		screenStore.updateModeConfig.mockResolvedValue(undefined);
	});

	it('offers only the Screens in Head-to-Head mode', () => {
		const { headToHeadScreens, hasHeadToHeadScreens } = useSendHeadToHeadToScreen();

		expect(headToHeadScreens.value.map(screen => screen.id)).toEqual([2, 3]);
		expect(hasHeadToHeadScreens.value).toBe(true);
	});

	it('points a Screen at the two Players, picked directly, and confirms it', async () => {
		const { sendToScreen } = useSendHeadToHeadToScreen();

		await expect(sendToScreen(42, 43, allScreens[2] as never)).resolves.toBe(true);

		expect(screenStore.updateModeConfig).toHaveBeenCalledWith(1, 3, 'head-to-head', { playerSource: 'players', player1Id: 42, player2Id: 43 });
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Head-to-Head sent', color: 'success' }));
	});

	it('reports a refused send as not sent', async () => {
		screenStore.updateModeConfig.mockRejectedValue(new Error('refused'));

		await expect(useSendHeadToHeadToScreen().sendToScreen(42, 43, allScreens[1] as never)).resolves.toBe(false);
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
	});

	it('sends nothing without an Event', async () => {
		eventStore.eventId = null;

		await expect(useSendHeadToHeadToScreen().sendToScreen(42, 43, allScreens[1] as never)).resolves.toBe(false);
		expect(screenStore.updateModeConfig).not.toHaveBeenCalled();
	});

	it('sends to the first Head-to-Head Screen', async () => {
		await expect(useSendHeadToHeadToScreen().sendToFirstHeadToHeadScreen(42, 43)).resolves.toBe(true);

		expect(screenStore.updateModeConfig).toHaveBeenCalledWith(1, 2, 'head-to-head', { playerSource: 'players', player1Id: 42, player2Id: 43 });
	});

	it('warns instead of sending when no Screen is in Head-to-Head mode', async () => {
		screenStore.screens = [allScreens[0]!];

		await expect(useSendHeadToHeadToScreen().sendToFirstHeadToHeadScreen(42, 43)).resolves.toBe(false);
		expect(screenStore.updateModeConfig).not.toHaveBeenCalled();
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'No Head-to-Head Screen', color: 'warning' }));
	});
});
