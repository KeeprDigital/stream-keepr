import type { VueWrapper } from '@vue/test-utils';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { fakeScreenThemeNetwork, overrideWrites, screenSettingsPage, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import ThemeTokenGroup from '~/components/Screen/ThemeTokenGroup.vue';

// A Screen Settings Group renders the Mode Tokens that name it under "Look",
// each a compact row writing its own Screen Theme Override.

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

enableAutoUnmount(afterEach);

beforeEach(() => {
	fakeScreenThemeNetwork(mockApiFetch);
});

async function mountGroup(group: string, themeOverrides: StoredThemeTokens = {}) {
	const screen = seedThemedScreen('pairings', themeOverrides);
	const wrapper = mount(screenSettingsPage(screen, () => h(ThemeTokenGroup, {
		screen: screen(),
		eventId: 1,
		group,
	})), {
		global: { stubs: nuxtUiStubs },
	});
	await flushPromises();
	return wrapper;
}

const row = (wrapper: VueWrapper, token: string) => wrapper.get(`[data-token="${token}"]`);

describe('a Screen Settings Group\'s Look', () => {
	it('lists the Mode Tokens declaring the group, under "Look", each showing whether it reads its default', async () => {
		const wrapper = await mountGroup('result-badge', { 'pairings.result-pending': '#ff0000' });

		expect(wrapper.get('[data-settings-group]').attributes('data-settings-group')).toBe('result-badge');
		expect(wrapper.text()).toContain('Look');
		expect(wrapper.findAll('[data-token]').map(entry => entry.attributes('data-token'))).toEqual([
			'pairings.result-reported',
			'pairings.result-pending',
			'pairings.result-bye',
		]);
		expect(row(wrapper, 'pairings.result-reported').attributes('data-token-state')).toBe('inherited');
		expect(row(wrapper, 'pairings.result-reported').text()).toContain('Default');
		expect(row(wrapper, 'pairings.result-pending').attributes('data-token-state')).toBe('set');
		expect(row(wrapper, 'pairings.result-pending').text()).toContain('Overridden');
	});

	it('renders nothing for a group no Mode Token of the mode declares', async () => {
		const wrapper = await mountGroup('chart');

		expect(wrapper.find('[data-settings-group]').exists()).toBe(false);
	});

	it.each([
		[
			'sets a row\'s colour through its picker, on close,',
			{},
			'pick colour',
			{ 'pairings.result-bye': 'rgba(255, 0, 0, 0.4)' },
		],
		[
			'clears a row\'s override',
			{ 'pairings.result-bye': '#ff0000' },
			'clear',
			{ 'pairings.result-bye': null },
		],
	] as const)('%s as one Screen Theme Override write', async (_case, stored, action, written) => {
		const wrapper = await mountGroup('result-badge', stored);
		const entry = row(wrapper, 'pairings.result-bye');

		if (action === 'clear') {
			await entry.findAll('button').find(button => button.text() === 'Clear')!.trigger('click');
		}
		else {
			await entry.get('[data-token-part="colour"]').trigger('click');
			await entry.get('[data-color-part="hue"]').setValue('#ff0000');
			await entry.get('[data-color-part="alpha"]').setValue(40);
			await entry.get('[data-token-part="colour"]').trigger('click');
		}
		await flushPromises();

		expect(overrideWrites(mockApiFetch)).toEqual([written]);
	});
});
