import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const { mockUseUnsavedChanges } = vi.hoisted(() => ({
	mockUseUnsavedChanges: vi.fn(),
}));

mockNuxtImport('useUnsavedChanges', () => mockUseUnsavedChanges);

const EventControlsStub = defineComponent({
	template: '<div data-test="event-controls">Overlay controls</div>',
});

const UContainerStub = defineComponent({
	template: '<div><slot /></div>',
});

async function mountPage() {
	const { default: ControlsPage } = await import('../../../../../app/pages/event/[eventId]/index.vue');
	return mount(ControlsPage, {
		global: {
			stubs: {
				EventControls: EventControlsStub,
				UContainer: UContainerStub,
			},
		},
	});
}

describe('event root controls page', () => {
	it('hosts the overlay controls at the event root', async () => {
		const wrapper = await mountPage();

		expect(mockUseUnsavedChanges).toHaveBeenCalledOnce();
		expect(wrapper.find('[data-test="event-controls"]').exists()).toBe(true);
	});
});
