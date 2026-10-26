import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent } from '~~/test/helpers/fixtures';

const mockStore = {
	setClock: vi.fn(),
};

const mockEventStore = {
	eventId: 1 as number | null,
	displayEvent: createMockEvent({ featureMatchDefaultClockDuration: 45 }),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockStore);

describe('useClockControls', () => {
	beforeEach(() => {
		mockEventStore.eventId = 1;
		mockEventStore.displayEvent = createMockEvent({ featureMatchDefaultClockDuration: 45 });
	});

	it('resets the clock to the Event\'s default duration', () => {
		const controls = useClockControls(10);

		void controls.resetToDefault();

		expect(controls.defaultDurationMs.value).toBe(45 * 60 * 1000);
		expect(mockStore.setClock).toHaveBeenCalledWith(1, 10, 45 * 60 * 1000);
	});

	it('does nothing without an Event', () => {
		mockEventStore.eventId = null;
		const controls = useClockControls(10);

		void controls.resetToDefault();
		void controls.set(60_000);

		expect(mockStore.setClock).not.toHaveBeenCalled();
	});

	it('does nothing when the Event has no default duration', () => {
		mockEventStore.displayEvent = createMockEvent({ featureMatchDefaultClockDuration: 0 });
		const controls = useClockControls(10);

		void controls.resetToDefault();

		expect(controls.defaultDurationMs.value).toBeUndefined();
		expect(mockStore.setClock).not.toHaveBeenCalled();
	});
});
