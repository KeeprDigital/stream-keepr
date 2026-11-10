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
		props: {
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

describe('graphicsInspectorSection', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('starts closed, showing its summary, and opens over it', async () => {
		const wrapper = mountSection({ summary: '30px · 800' });
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
		const first = mountSection();
		await flushPromises();
		await first.get('[data-testid="inspector-section-typography-toggle"]').trigger('click');
		first.unmount();

		const next = mountSection();
		await flushPromises();

		expect(shown(next)).toBe(true);
	});

	it('starts open where its host asks', async () => {
		const wrapper = mountSection({ id: 'layout', defaultOpen: true });
		await flushPromises();

		expect(shown(wrapper, 'layout')).toBe(true);
	});

	// The defaults changed, so what a browser remembered under them is not carried over.
	it('ignores open state remembered before sections started closed', async () => {
		localStorage.setItem('editor-inspectorSections', JSON.stringify({ typography: true }));

		const wrapper = mountSection();
		await flushPromises();

		expect(shown(wrapper)).toBe(false);
	});
});
