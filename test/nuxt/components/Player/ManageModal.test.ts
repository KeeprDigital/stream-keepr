import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMockPlayer } from '~~/test/helpers/fixtures';

const mockPlayerStore = {
	updatePlayer: vi.fn(),
	removePlayer: vi.fn(),
};
const mockToast = {
	add: vi.fn(),
};
/** The operator's answer to the unsaved-changes confirmation. */
const confirmOpen = vi.fn(() => ({
	result: Promise.resolve(false),
}));
let routeGuard: (() => Promise<boolean> | boolean) | null = null;
const removeRouteGuard = vi.fn();

mockNuxtImport('useEventStore', () => () => ({ eventId: 1 }));
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({ open: confirmOpen }),
}));

const UModalStub = defineComponent({
	props: {
		close: { type: Object, required: false },
	},
	template: '<div><button data-testid="modal-close" @click="close?.onClick?.()" /><slot name="body" /><slot name="footer" /></div>',
});

const UFormStub = defineComponent({
	emits: ['submit'],
	template: '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :data-label="label" :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});

const FormFieldsStub = defineComponent({
	name: 'PlayerFormFields',
	props: {
		modelValue: { type: Object, required: true },
		mtgGameData: { type: Object, required: true },
		opGameData: { type: Object, required: true },
	},
	emits: ['update:modelValue', 'update:mtgGameData', 'update:opGameData'],
	template: '<div />',
});

const componentPath = '../../../../app/components/Player/ManageModal.vue';

enableAutoUnmount(afterEach);

async function mountModal() {
	const { default: ManageModal } = await import(componentPath);
	return mount(ManageModal, {
		props: {
			player: createMockPlayer({
				id: 7,
				eventId: 1,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' },
			}),
			game: 'mtg',
		},
		global: {
			stubs: {
				UModal: UModalStub,
				UForm: UFormStub,
				UButton: UButtonStub,
				UDropdownMenu: { template: '<div><slot /></div>' },
				PlayerFormFields: FormFieldsStub,
			},
		},
	});
}

type Wrapper = Awaited<ReturnType<typeof mountModal>>;

function fields(wrapper: Wrapper) {
	return wrapper.getComponent(FormFieldsStub);
}

function editName(wrapper: Wrapper, name: string) {
	fields(wrapper).vm.$emit('update:modelValue', {
		...fields(wrapper).props('modelValue'),
		name,
	});
}

function saveButton(wrapper: Wrapper) {
	return wrapper.get('[data-label="Save"]');
}

describe('player manage modal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeGuard = null;
		// The real router, so Nuxt keeps its own guards; only the modal's is captured.
		vi.spyOn(useRouter(), 'beforeEach').mockImplementation((guard) => {
			routeGuard = guard as () => Promise<boolean>;
			return removeRouteGuard;
		});
		confirmOpen.mockReturnValue({
			result: Promise.resolve(false),
		});
		mockPlayerStore.updatePlayer.mockResolvedValue(createMockPlayer({ id: 7 }));
	});

	// The deck fields lived outside the tracked form, so editing only the deck
	// left Save disabled.
	it('offers Save for a deck-only edit', async () => {
		const wrapper = await mountModal();
		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();

		fields(wrapper).vm.$emit('update:mtgGameData', { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' });
		await flushPromises();

		expect(saveButton(wrapper).attributes('disabled')).toBeUndefined();
	});

	it('saves a deck-only edit', async () => {
		const wrapper = await mountModal();

		fields(wrapper).vm.$emit('update:mtgGameData', { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' });
		await flushPromises();
		await wrapper.get('form').trigger('submit');
		await flushPromises();

		expect(mockPlayerStore.updatePlayer).toHaveBeenCalledWith(1, 7, expect.objectContaining({
			gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
		}));
	});

	it('closes without asking when nothing is unsaved', async () => {
		const wrapper = await mountModal();

		await wrapper.get('[data-testid="modal-close"]').trigger('click');
		await flushPromises();

		expect(confirmOpen).not.toHaveBeenCalled();
		expect(wrapper.emitted('close')).toHaveLength(1);
	});

	it('stays open on an unsaved edit when the operator keeps it', async () => {
		const wrapper = await mountModal();
		editName(wrapper, 'Alicia');
		await flushPromises();

		await wrapper.get('[data-testid="modal-close"]').trigger('click');
		await flushPromises();

		expect(confirmOpen).toHaveBeenCalledTimes(1);
		expect(wrapper.emitted('close')).toBeUndefined();
	});

	it('closes on an unsaved edit once the operator discards it', async () => {
		confirmOpen.mockReturnValue({
			result: Promise.resolve(true),
		});
		const wrapper = await mountModal();
		editName(wrapper, 'Alicia');
		await flushPromises();

		await wrapper.get('[data-testid="modal-close"]').trigger('click');
		await flushPromises();

		expect(wrapper.emitted('close')).toHaveLength(1);
	});

	it('holds navigation on an unsaved edit until the operator discards it', async () => {
		const wrapper = await mountModal();
		expect(await routeGuard!()).toBe(true);

		editName(wrapper, 'Alicia');
		await flushPromises();
		expect(await routeGuard!()).toBe(false);

		confirmOpen.mockReturnValue({
			result: Promise.resolve(true),
		});
		expect(await routeGuard!()).toBe(true);
	});

	it('stops guarding once the save lands', async () => {
		const wrapper = await mountModal();
		editName(wrapper, 'Alicia');
		await flushPromises();

		await wrapper.get('form').trigger('submit');
		await flushPromises();

		expect(wrapper.emitted('close')).toHaveLength(1);
		expect(await routeGuard!()).toBe(true);
		expect(confirmOpen).not.toHaveBeenCalled();
	});

	it('removes its navigation guard when it closes', async () => {
		const wrapper = await mountModal();

		wrapper.unmount();

		expect(removeRouteGuard).toHaveBeenCalled();
	});
});
