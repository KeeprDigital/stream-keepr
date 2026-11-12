import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import SettingsSection from '~/components/Screen/SettingsSection.vue';

enableAutoUnmount(afterEach);

function mountCard(props: Record<string, unknown> = {}) {
	return mount(SettingsSection, {
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

describe('screenSettingsSection, as a page card', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** The toggle's ARIA state, or `null` when the card renders no toggle. */
	function ariaState(wrapper: ReturnType<typeof mountCard>) {
		const button = toggle(wrapper);
		if (!button.exists())
			return null;
		const controls = button.attributes('aria-controls');
		return {
			expanded: button.attributes('aria-expanded'),
			controlsBody: controls !== undefined && wrapper.find(`#${controls} [data-testid="field"]`).exists(),
		};
	}

	const OPEN = { expanded: 'true', controlsBody: true };
	const CLOSED = { expanded: 'false', controlsBody: false };

	it.each([
		{
			name: 'open by default',
			props: {},
			before: OPEN,
			afterToggle: CLOSED,
		},
		{
			name: 'defaultOpen: false',
			props: { defaultOpen: false },
			before: CLOSED,
			afterToggle: OPEN,
		},
		{
			name: 'collapsible: false',
			props: { collapsible: false, defaultOpen: false },
			before: null,
			afterToggle: null,
		},
	])('$name: the toggle\'s ARIA state follows the body', async ({ props, before, afterToggle }) => {
		const wrapper = mountCard(props);
		await flushPromises();

		expect(ariaState(wrapper)).toEqual(before);
		expect(wrapper.find('[data-testid="field"]').exists()).toBe(before?.expanded !== 'false');
		expect(wrapper.get('[data-testid="action"]').text()).toBe(before?.expanded === 'false'
			? 'closed'
			: 'open');

		if (before) {
			await toggle(wrapper).trigger('click');
			expect(ariaState(wrapper)).toEqual(afterToggle);
		}
	});

	it('renders its title and subtitle once, open or closed', async () => {
		const wrapper = mountCard({ subtitle: 'Badges on each card.' });
		await flushPromises();
		await toggle(wrapper).trigger('click');

		expect(wrapper.findAll('h3').map(heading => heading.text())).toEqual(['Card Badges']);
		expect(wrapper.text().split('Badges on each card.')).toHaveLength(2);
	});

	// Remembered per browser by `mode:card` id; with no id, a remount starts over.
	it.each([
		{
			name: 'an id closed before remount',
			props: { id: 'top-cards:badges' },
			closeFirst: true,
			expanded: 'false',
		},
		{
			name: 'an id never toggled',
			props: { id: 'top-cards:badges' },
			closeFirst: false,
			expanded: 'true',
		},
		{
			name: 'an id never toggled, defaultOpen: false',
			props: { id: 'top-cards:badges', defaultOpen: false },
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
		const wrapper = mount(SettingsSection, {
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

		const wrapper = mountCard({ id: 'top-cards:badges', defaultOpen: false });
		await flushPromises();
		expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');

		await toggle(wrapper).trigger('click');
		expect(toggle(wrapper).attributes('aria-expanded')).toBe('true');
	});
});

/** The row density: one section of a property panel, remembered by section id rather than per item. */
describe('screenSettingsSection, as an inspector row', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	function mountRow(props: { id?: string; defaultOpen?: boolean; summary?: string } = {}) {
		return mount(SettingsSection, {
			props: {
				density: 'row',
				id: props.id ?? 'typography',
				title: 'Text style',
				summary: props.summary,
				defaultOpen: props.defaultOpen,
			},
			slots: {
				default: () => h('input', { 'data-testid': 'field' }),
			},
			global: {
				stubs: { UIcon: true },
			},
		});
	}

	// A closed row hides its body rather than unmounting it.
	function shown(wrapper: ReturnType<typeof mountRow>, id = 'typography') {
		return !(wrapper.get(`[data-testid="inspector-section-${id}"]`).attributes('style') ?? '').includes('display: none');
	}

	it('starts closed, showing its summary, and opens over it', async () => {
		const wrapper = mountRow({ summary: '30px · 800' });
		await flushPromises();
		expect(shown(wrapper)).toBe(false);
		expect(wrapper.text()).toContain('30px · 800');
		expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');

		await wrapper.get('[data-testid="inspector-section-typography-toggle"]').trigger('click');

		expect(shown(wrapper)).toBe(true);
		expect(wrapper.text()).not.toContain('30px · 800');
		expect(wrapper.get('button').attributes('aria-expanded')).toBe('true');
	});

	it('remembers an opened section for the next item that shows it', async () => {
		const first = mountRow();
		await flushPromises();
		await first.get('[data-testid="inspector-section-typography-toggle"]').trigger('click');
		first.unmount();

		const next = mountRow();
		await flushPromises();

		expect(shown(next)).toBe(true);
	});

	it('starts open where its host asks', async () => {
		const wrapper = mountRow({ id: 'layout', defaultOpen: true });
		await flushPromises();

		expect(shown(wrapper, 'layout')).toBe(true);
	});

	// The defaults changed, so what a browser remembered under them is not carried over.
	it('ignores open state remembered before sections started closed', async () => {
		localStorage.setItem('editor-inspectorSections', JSON.stringify({ typography: true }));

		const wrapper = mountRow();
		await flushPromises();

		expect(shown(wrapper)).toBe(false);
	});

	it('keeps what a page card of the same id remembers apart', async () => {
		const row = mountRow();
		await flushPromises();
		await row.get('[data-testid="inspector-section-typography-toggle"]').trigger('click');
		row.unmount();

		const card = mount(SettingsSection, {
			props: { title: 'Text style', id: 'typography', defaultOpen: false },
			global: { stubs: nuxtUiStubs },
		});
		await flushPromises();

		expect(card.get('button[aria-expanded]').attributes('aria-expanded')).toBe('false');
	});
});
