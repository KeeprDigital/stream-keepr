import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent } from '~~/test/helpers/fixtures';

const mockToast = { add: vi.fn() };
const mockStore = {
	event: createMockEvent(),
	updateEvent: vi.fn(),
	$reset: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => mockStore);
mockNuxtImport('useToast', () => () => mockToast);

describe('useEventConfigSubmit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Restore event after clearAllMocks (clearAllMocks only clears mock fn call history, not object properties)
		mockStore.event = createMockEvent();
	});

	it('calls eventStore.updateEvent with the provided data', async () => {
		mockStore.updateEvent.mockResolvedValue(undefined);
		const { handleSubmit } = useEventConfigSubmit();

		await handleSubmit({ name: 'Updated Event' } as any);
		expect(mockStore.updateEvent).toHaveBeenCalledWith({ name: 'Updated Event' });
	});

	it('shows success toast on successful update', async () => {
		mockStore.updateEvent.mockResolvedValue(undefined);
		const { handleSubmit } = useEventConfigSubmit();

		await handleSubmit({ name: 'Updated' } as any);
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Success',
			color: 'success',
		}));
	});
});
