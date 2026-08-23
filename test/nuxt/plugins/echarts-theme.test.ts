import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import { THEME_KEY } from 'vue-echarts';

const { mockTheme } = vi.hoisted(() => ({ mockTheme: { marker: 'echarts-theme' } }));

mockNuxtImport('useEChartsTheme', () => () => mockTheme);

describe('echartsThemePlugin', () => {
	it('provides the app-wide chart theme under vue-echarts\' own key', async () => {
		const { default: plugin } = await import('~/plugins/echarts-theme.client');
		const provide = vi.fn();

		(plugin as unknown as (nuxtApp: unknown) => void)({ vueApp: { provide } });

		expect(provide).toHaveBeenCalledWith(THEME_KEY, mockTheme);
	});
});
