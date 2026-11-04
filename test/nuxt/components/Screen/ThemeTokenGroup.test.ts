import type { VueWrapper } from '@vue/test-utils';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { fakeScreenThemeNetwork, overrideWrites, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import ScreenSettingsCard from '~/components/Screen/SettingsCard.vue';
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
	const screen = seedThemedScreen('standings', themeOverrides);
	const Host = defineComponent(() => () => h(ThemeTokenGroup, {
		screen: screen(),
		eventId: 1,
		group,
	}));
	const wrapper = mount(Host, {
		global: { stubs: nuxtUiStubs },
	});
	await flushPromises();
	return wrapper;
}

const row = (wrapper: VueWrapper, token: string) => wrapper.get(`[data-token="${token}"]`);

describe('a Screen Settings Group\'s Look', () => {
	it('lists the Mode Tokens declaring the group, under "Look", each showing whether it follows the Theme', async () => {
		const wrapper = await mountGroup('header', { 'standings.title-text': '#ff0000' });

		expect(wrapper.get('[data-settings-group]').attributes('data-settings-group')).toBe('header');
		expect(wrapper.text()).toContain('Look');
		expect(wrapper.findAll('[data-token]').map(entry => entry.attributes('data-token'))).toEqual([
			'standings.title-typography',
			'standings.title-text',
			'standings.title-divider',
		]);
		expect(row(wrapper, 'standings.title-typography').attributes('data-token-state')).toBe('inherited');
		expect(row(wrapper, 'standings.title-typography').text()).toContain('Theme');
		expect(row(wrapper, 'standings.title-text').attributes('data-token-state')).toBe('set');
		expect(row(wrapper, 'standings.title-text').text()).toContain('Overridden');
	});

	it('renders nothing for a group no Mode Token of the mode declares', async () => {
		const wrapper = await mountGroup('chart');

		expect(wrapper.find('[data-settings-group]').exists()).toBe(false);
	});

	it.each([
		[
			'points a row at another Foundation Token',
			{},
			'follow accent',
			{
				'standings.title-divider': { token: 'accent' },
			},
		],
		[
			'sets a row\'s colour through its picker, on close,',
			{},
			'pick colour',
			{ 'standings.title-divider': 'rgba(255, 0, 0, 0.4)' },
		],
		[
			'clears a row\'s override',
			{ 'standings.title-divider': '#ff0000' },
			'clear',
			{ 'standings.title-divider': null },
		],
	] as const)('%s as one Screen Theme Override write', async (_case, stored, action, written) => {
		const wrapper = await mountGroup('header', stored);
		const entry = row(wrapper, 'standings.title-divider');

		if (action === 'clear') {
			await entry.findAll('button').find(button => button.text() === 'Clear')!.trigger('click');
		}
		else if (action === 'pick colour') {
			await entry.get('[data-token-part="colour"]').trigger('click');
			await entry.get('[data-color-part="hue"]').setValue('#ff0000');
			await entry.get('[data-color-part="alpha"]').setValue(40);
			await entry.get('[data-token-part="colour"]').trigger('click');
		}
		else {
			await entry.get('[data-token-part="source"]').setValue('accent');
		}
		await flushPromises();

		expect(overrideWrites(mockApiFetch)).toEqual([written]);
	});
});

// A collapsed card unmounts its body, but its groups' tokens stay out of the Screen-wide look.
describe('a Screen Settings Group\'s registration', () => {
	async function mountInCard() {
		const screen = seedThemedScreen('standings');
		const showCard = ref(true);
		const Page = defineComponent(() => {
			const groups = provideScreenSettingsGroups();
			return () => h('div', {
				'data-mounted-groups': [...groups.mounted.value].join(' '),
			}, showCard.value
				? [
						h(ScreenSettingsCard, { title: 'Header' }, () => h(ThemeTokenGroup, {
							screen: screen(),
							eventId: 1,
							group: 'header',
						})),
					]
				: []);
		});
		const wrapper = mount(Page, {
			global: { stubs: nuxtUiStubs },
		});
		await flushPromises();
		return { wrapper, showCard };
	}

	const mountedGroups = (wrapper: VueWrapper) => wrapper.get('[data-mounted-groups]').attributes('data-mounted-groups');

	it('holds its group while its card is collapsed, and releases it when the card goes', async () => {
		const { wrapper, showCard } = await mountInCard();
		expect(mountedGroups(wrapper)).toBe('header');

		await wrapper.get('button[aria-label="Collapse Header"]').trigger('click');
		await wrapper.get('button[aria-label="Expand Header"]').trigger('click');
		await wrapper.get('button[aria-label="Collapse Header"]').trigger('click');
		expect(wrapper.find('[data-settings-group]').exists()).toBe(false);
		expect(mountedGroups(wrapper)).toBe('header');

		showCard.value = false;
		await flushPromises();
		expect(mountedGroups(wrapper)).toBe('');
	});
});
