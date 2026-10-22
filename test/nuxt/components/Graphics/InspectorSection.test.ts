import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import InspectorSection from '~/components/Graphics/InspectorSection.vue';

/**
 * One collapsible property panel section, whose open state is remembered per
 * browser by id rather than per item.
 */

enableAutoUnmount(afterEach);

function shown(wrapper: ReturnType<typeof mountSection>, id = 'typography') {
	return !(wrapper.get(`[data-testid="inspector-section-${id}"]`).attributes('style') ?? '').includes('display: none');
}

function mountSection(props: { id?: string; defaultOpen?: boolean; summary?: string } = {}) {
	return mount(InspectorSection, {
		props: { id: props.id ?? 'typography', title: 'Text style', summary: props.summary, defaultOpen: props.defaultOpen },
		slots: { default: () => h('input', { 'data-testid': 'field' }) },
		global: { stubs: { UIcon: true } },
	});
}

describe('graphicsInspectorSection', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('opens by default and collapses to its summary', async () => {
		const wrapper = mountSection({ summary: '30px · 800' });
		await flushPromises();
		expect(shown(wrapper)).toBe(true);
		expect(wrapper.text()).not.toContain('30px · 800');

		await wrapper.get('[data-testid="inspector-section-typography-toggle"]').trigger('click');

		expect(shown(wrapper)).toBe(false);
		expect(wrapper.text()).toContain('30px · 800');
		expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
	});

	it('remembers a collapsed section for the next item that shows it', async () => {
		const first = mountSection();
		await flushPromises();
		await first.get('[data-testid="inspector-section-typography-toggle"]').trigger('click');
		first.unmount();

		const next = mountSection();
		await flushPromises();

		expect(shown(next)).toBe(false);
	});

	it('starts closed where its host asks', async () => {
		const wrapper = mountSection({ id: 'animation', defaultOpen: false });
		await flushPromises();

		expect(shown(wrapper, 'animation')).toBe(false);
	});
});
