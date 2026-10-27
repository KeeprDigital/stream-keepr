import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateScreenConfig = vi.fn();
const mockToast = {
	add: vi.fn(),
};

const mockScreenStore = {
	screens: [
		{
			id: 1,
			screenConfig: { background: '#000' },
		},
	],
	updateScreenConfig: mockUpdateScreenConfig,
};

mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useToast', () => () => mockToast);

describe('useScreenConfigUpdate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows the stored config, then an edit at once, and saves the edit after the debounce', async () => {
		const { screenConfig, updateScreenConfig } = useScreenConfigUpdate(1, 1, { debounceMs: 100 });
		expect(screenConfig.value.background).toBe('#000');

		updateScreenConfig({ background: '#fff' });
		expect(screenConfig.value.background).toBe('#fff');

		await vi.advanceTimersByTimeAsync(200);
		expect(mockUpdateScreenConfig).toHaveBeenCalledWith(1, 1, { background: '#fff' });
	});

	it('resetScreenConfig preserves appearance fields after debounce', async () => {
		const { resetScreenConfig } = useScreenConfigUpdate(1, 1, { debounceMs: 100 });
		resetScreenConfig();

		await vi.advanceTimersByTimeAsync(200);
		expect(mockUpdateScreenConfig).toHaveBeenCalledWith(1, 1, {
			paddingX: null,
			paddingY: null,
			horizontalAlign: null,
			verticalAlign: null,
		});
	});
});
