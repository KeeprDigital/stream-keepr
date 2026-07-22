import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';

const eventStore = reactive({ eventId: 1 });
const playerListStore = {
	addMembers: vi.fn(),
	batchRemoveMembers: vi.fn(),
	reorderMembers: vi.fn(),
	loadListMembers: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('usePlayerListStore', () => () => playerListStore);

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});

const VueDraggableStub = defineComponent({
	props: { modelValue: { type: Array, required: true } },
	template: '<div><slot /></div>',
});

async function mountPane() {
	const { default: ListMembersPane } = await import('../../../../app/components/Player/ListMembersPane.vue');
	return mount(ListMembersPane, {
		props: {
			listId: 5,
			allPlayers: [
				{ id: 1, name: 'Alice' },
				{ id: 2, name: 'Bob' },
			] as any,
			initialMemberIds: [1],
		},
		global: {
			stubs: {
				UButton: UButtonStub,
				UCheckbox: true,
				UInput: true,
				UDropdownMenu: true,
				UIcon: true,
				VueDraggable: VueDraggableStub,
			},
		},
	});
}

describe('playerListMembersPane', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		playerListStore.addMembers.mockResolvedValue({ success: true });
		playerListStore.batchRemoveMembers.mockResolvedValue({ success: true });
		playerListStore.reorderMembers.mockResolvedValue({ success: true });
		playerListStore.loadListMembers.mockResolvedValue([1, 2]);
	});

	it('does not continue or report success after a member mutation returns null', async () => {
		const wrapper = await mountPane();
		await wrapper.get('[aria-label="Add Bob to list"]').trigger('click');
		playerListStore.addMembers.mockResolvedValueOnce(null);

		await expect((wrapper.vm as any).save()).rejects.toThrow('Failed to add list members');

		expect(playerListStore.reorderMembers).not.toHaveBeenCalled();
		expect(playerListStore.loadListMembers).not.toHaveBeenCalled();
	});

	it('uses a single-column transfer layout until large viewports', async () => {
		const wrapper = await mountPane();
		const grid = wrapper.get('.grid');

		expect(grid.classes()).toContain('grid-cols-1');
		expect(grid.classes()).toContain('lg:grid-cols-2');
	});
});
