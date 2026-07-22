import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateModeConfig = vi.fn();
const mockToast = { add: vi.fn() };

const mockScreenStore = {
	screens: [{ id: 1, modeConfigs: { 'feature-match': { featureMatchId: 5 } } }],
	updateModeConfig: mockUpdateModeConfig,
};

mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useToast', () => () => mockToast);

describe('useModeConfigUpdate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns config, saving, updateConfig, resetConfig', () => {
		const result = useModeConfigUpdate(1, 1, 'feature-match');
		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('saving');
		expect(result).toHaveProperty('updateConfig');
		expect(result).toHaveProperty('resetConfig');
	});

	it('merges store mode config with defaults', () => {
		const { config } = useModeConfigUpdate(1, 1, 'feature-match');
		expect(config.value.featureMatchId).toBe(5);
	});

	it('applies local overrides immediately on updateConfig', () => {
		const { config, updateConfig } = useModeConfigUpdate(1, 1, 'feature-match');
		updateConfig({ featureMatchId: 10 } as any);
		expect(config.value.featureMatchId).toBe(10);
	});

	it('saves to store after debounce', async () => {
		const { updateConfig } = useModeConfigUpdate(1, 1, 'feature-match', { debounceMs: 100 });
		updateConfig({ featureMatchId: 10 } as any);

		await vi.advanceTimersByTimeAsync(200);
		expect(mockUpdateModeConfig).toHaveBeenCalledWith(1, 1, 'feature-match', { featureMatchId: 10 });
	});
});
