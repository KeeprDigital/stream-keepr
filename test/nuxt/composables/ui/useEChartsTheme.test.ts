import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';

const colorMode = ref('light');

mockNuxtImport('useColorMode', () => () => colorMode);

describe('useEChartsTheme', () => {
	beforeEach(() => {
		colorMode.value = 'light';
		document.documentElement.removeAttribute('style');
	});

	it('builds a light theme from CSS variables when available', () => {
		document.documentElement.style.setProperty('--ui-bg', '#fafafa');
		document.documentElement.style.setProperty('--ui-bg-elevated', '#ffffff');
		document.documentElement.style.setProperty('--ui-border', '#dddddd');
		document.documentElement.style.setProperty('--ui-border-muted', '#cccccc');
		document.documentElement.style.setProperty('--ui-text', '#111111');
		document.documentElement.style.setProperty('--ui-text-muted', '#666666');
		document.documentElement.style.setProperty('--ui-primary', '#123456');

		const theme = useEChartsTheme();

		expect(theme.value).toMatchObject({
			backgroundColor: '#fafafa',
			color: expect.arrayContaining(['#123456']),
			textStyle: { color: '#111111' },
			legend: expect.objectContaining({ inactiveColor: '#dddddd' }),
			tooltip: expect.objectContaining({ backgroundColor: '#ffffff', borderColor: '#dddddd' }),
		});
	});
});
