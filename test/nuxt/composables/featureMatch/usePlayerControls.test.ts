import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStore = {
	adjustLife: vi.fn(),
	setLife: vi.fn(),
	updatePlayerFeatureMatchState: vi.fn(),
	recordGameWin: vi.fn(),
	undoGameWin: vi.fn(),
	setCardsKept: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => ({ eventId: 1 }));
mockNuxtImport('useFeatureMatchStateStore', () => () => mockStore);

describe('usePlayerControls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('delegates adjustLife to store', () => {
		const controls = usePlayerControls(10, 'player1');
		controls.adjustLife(5);
		expect(mockStore.adjustLife).toHaveBeenCalledWith(1, 10, 'player1', 5);
	});

	it('delegates setLife to store', () => {
		const controls = usePlayerControls(10, 'player1');
		controls.setLife(20);
		expect(mockStore.setLife).toHaveBeenCalledWith(1, 10, 'player1', 20);
	});

	it('delegates updateCounters to store', () => {
		const counters = [{ type: 'poison', value: 3 }];
		const controls = usePlayerControls(10, 'player1');
		controls.updateCounters(counters);
		expect(mockStore.updatePlayerFeatureMatchState).toHaveBeenCalledWith(1, 10, 'player1', { counters });
	});

	it('delegates recordWin to store', () => {
		const controls = usePlayerControls(10, 'player1');
		void controls.recordWin({ resetLife: true });
		expect(mockStore.recordGameWin).toHaveBeenCalledWith(1, 10, 'player1', { resetLife: true });
	});

	it('delegates undoWin to store', () => {
		const controls = usePlayerControls(10, 'player2');
		void controls.undoWin();
		expect(mockStore.undoGameWin).toHaveBeenCalledWith(1, 10, 'player2', undefined);
	});

	it('delegates setCardsKept to store', () => {
		const controls = usePlayerControls(10, 'player1');
		void controls.setCardsKept(6);
		expect(mockStore.setCardsKept).toHaveBeenCalledWith(1, 10, 'player1', 6);
	});

	it('supports reactive matchId', () => {
		const matchId = ref(10);
		const controls = usePlayerControls(matchId, 'player1');
		controls.adjustLife(1);
		expect(mockStore.adjustLife).toHaveBeenCalledWith(1, 10, 'player1', 1);

		matchId.value = 20;
		controls.adjustLife(2);
		expect(mockStore.adjustLife).toHaveBeenCalledWith(1, 20, 'player1', 2);
	});
});
