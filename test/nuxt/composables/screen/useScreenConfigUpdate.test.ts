import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateScreenConfig = vi.fn();
const mockToast = { add: vi.fn() };

const mockScreenStore = {
	screens: [{ id: 1, screenConfig: { background: '#000' } }],
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

	it('returns screenConfig, saving, updateScreenConfig, resetScreenConfig', () => {
		const result = useScreenConfigUpdate(1, 1);
		expect(result).toHaveProperty('screenConfig');
		expect(result).toHaveProperty('saving');
		expect(result).toHaveProperty('updateScreenConfig');
		expect(result).toHaveProperty('resetScreenConfig');
	});

	it('merges store config with defaults', () => {
		const { screenConfig } = useScreenConfigUpdate(1, 1);
		expect(screenConfig.value.background).toBe('#000');
	});

	it('applies local overrides immediately', () => {
		const { screenConfig, updateScreenConfig } = useScreenConfigUpdate(1, 1);
		updateScreenConfig({ background: '#fff' });
		expect(screenConfig.value.background).toBe('#fff');
	});

	it('calls saveToStore after debounce', async () => {
		const { updateScreenConfig } = useScreenConfigUpdate(1, 1, { debounceMs: 100 });
		updateScreenConfig({ background: '#fff' });

		await vi.advanceTimersByTimeAsync(200);
		expect(mockUpdateScreenConfig).toHaveBeenCalledWith(1, 1, { background: '#fff' });
	});

	it('resetScreenConfig preserves appearance fields after debounce', async () => {
		const { resetScreenConfig } = useScreenConfigUpdate(1, 1, { debounceMs: 100 });
		resetScreenConfig();

		await vi.advanceTimersByTimeAsync(200);
		expect(mockUpdateScreenConfig).toHaveBeenCalledWith(1, 1, {
			width: null,
			height: null,
			paddingX: null,
			paddingY: null,
			horizontalAlign: null,
			verticalAlign: null,
		});
	});
});
