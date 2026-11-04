import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import SettingsCard from '~/components/Screen/SettingsCard.vue';

enableAutoUnmount(afterEach);

function mountCard(props: Record<string, unknown> = {}) {
	return mount(SettingsCard, {
		props: { title: 'Card Badges', ...props },
		slots: {
			default: () => h('input', { 'data-testid': 'field' }),
			actions: ({ open }: { open: boolean }) => h('span', { 'data-testid': 'action' }, open ? 'open' : 'closed'),
		},
		global: { stubs: nuxtUiStubs },
	});
}

function toggle(wrapper: ReturnType<typeof mountCard>) {
	return wrapper.find('button[aria-expanded]');
}

describe('screenSettingsCard', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		{
			name: 'open by default',
			props: {},
			expanded: 'true',
			afterToggle: 'false',
		},
		{
			name: 'defaultOpen: false',
			props: { defaultOpen: false },
			expanded: 'false',
			afterToggle: 'true',
		},
	])('$name: the toggle\'s aria-expanded follows the open body', async ({ props, expanded, afterToggle }) => {
		const wrapper = mountCard(props);
		await flushPromises();

		expect(toggle(wrapper).attributes('aria-expanded')).toBe(expanded);
		expect(wrapper.find('[data-testid="field"]').exists()).toBe(expanded === 'true');
		expect(wrapper.get('[data-testid="action"]').text()).toBe(expanded === 'true'
			? 'open'
			: 'closed');
		const body = wrapper.find(`#${toggle(wrapper).attributes('aria-controls')}`);
		expect(body.exists()).toBe(expanded === 'true');

		await toggle(wrapper).trigger('click');

		expect(toggle(wrapper).attributes('aria-expanded')).toBe(afterToggle);
		expect(wrapper.find('[data-testid="field"]').exists()).toBe(afterToggle === 'true');
		expect(wrapper.findAll('h3').map(heading => heading.text())).toEqual(['Card Badges']);
	});

	it('collapsible: false shows its body with no toggle', async () => {
		const wrapper = mountCard({ collapsible: false, subtitle: 'Badges on each card.' });
		await flushPromises();

		expect(toggle(wrapper).exists()).toBe(false);
		expect(wrapper.find('[data-testid="field"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Badges on each card.');
	});

	// Remembered per browser by `mode:card` id; with no id, a remount starts over.
	it.each([
		{
			name: 'an id closed before remount',
			props: { id: 'topCards:badges' },
			closeFirst: true,
			expanded: 'false',
		},
		{
			name: 'an id never toggled',
			props: { id: 'topCards:badges' },
			closeFirst: false,
			expanded: 'true',
		},
		{
			name: 'an id never toggled, defaultOpen: false',
			props: { id: 'topCards:badges', defaultOpen: false },
			closeFirst: false,
			expanded: 'false',
		},
		{
			name: 'no id, closed before remount',
			props: {},
			closeFirst: true,
			expanded: 'true',
		},
	])('$name: remounts with aria-expanded $expanded and the summary shown only while closed', async ({ props, closeFirst, expanded }) => {
		const cardProps = { ...props, summary: 'Rarity · Price' };
		if (closeFirst) {
			const first = mountCard(cardProps);
			await flushPromises();
			await toggle(first).trigger('click');
			first.unmount();
		}

		const wrapper = mountCard(cardProps);
		await flushPromises();

		expect(toggle(wrapper).attributes('aria-expanded')).toBe(expanded);
		expect(wrapper.text().includes('Rarity · Price')).toBe(expanded === 'false');
	});

	it('shows a summary slot in the closed header', async () => {
		const wrapper = mount(SettingsCard, {
			props: { title: 'Card Badges', defaultOpen: false },
			slots: {
				summary: () => h('span', 'Rarity on'),
			},
			global: { stubs: nuxtUiStubs },
		});
		await flushPromises();

		expect(wrapper.text()).toContain('Rarity on');
		await toggle(wrapper).trigger('click');
		expect(wrapper.text()).not.toContain('Rarity on');
	});

	it('falls back to defaultOpen, and still toggles, when storage is unavailable', async () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('storage refused');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('storage refused');
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const wrapper = mountCard({ id: 'topCards:badges', defaultOpen: false });
		await flushPromises();
		expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');

		await toggle(wrapper).trigger('click');
		expect(toggle(wrapper).attributes('aria-expanded')).toBe('true');
	});
});
