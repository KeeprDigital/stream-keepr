import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent } from '~~/test/helpers/fixtures';

const mockStore = {
	startClock: vi.fn(),
	pauseClock: vi.fn(),
	resetClock: vi.fn(),
	restartClock: vi.fn(),
	adjustClock: vi.fn(),
	setClock: vi.fn(),
};

const mockEventStore = {
	eventId: 1,
	event: createMockEvent({ featureMatchDefaultClockDuration: 50 }),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockStore);

describe('useClockControls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.eventId = 1;
	});

	it('delegates start to store.startClock', () => {
		const controls = useClockControls(10);
		void controls.start();
		expect(mockStore.startClock).toHaveBeenCalledWith(1, 10);
	});

	it('delegates pause to store.pauseClock', () => {
		const controls = useClockControls(10);
		void controls.pause();
		expect(mockStore.pauseClock).toHaveBeenCalledWith(1, 10);
	});

	it('delegates reset to store.resetClock', () => {
		const controls = useClockControls(10);
		void controls.reset();
		expect(mockStore.resetClock).toHaveBeenCalledWith(1, 10);
	});

	it('delegates restart to store.restartClock', () => {
		const controls = useClockControls(10);
		void controls.restart();
		expect(mockStore.restartClock).toHaveBeenCalledWith(1, 10);
	});

	it('delegates adjust to store.adjustClock', () => {
		const controls = useClockControls(10);
		controls.adjust(5000);
		expect(mockStore.adjustClock).toHaveBeenCalledWith(1, 10, 5000);
	});

	it('delegates set to store.setClock', () => {
		const controls = useClockControls(10);
		void controls.set(60000);
		expect(mockStore.setClock).toHaveBeenCalledWith(1, 10, 60000);
	});

	it('computes defaultDurationMs from event config', () => {
		const controls = useClockControls(10);
		// 50 minutes * 60 * 1000 = 3_000_000
		expect(controls.defaultDurationMs.value).toBe(3_000_000);
	});

	it('delegates resetToDefault to store.setClock with defaultDurationMs', () => {
		const controls = useClockControls(10);
		void controls.resetToDefault();
		expect(mockStore.setClock).toHaveBeenCalledWith(1, 10, 3_000_000);
	});
});
