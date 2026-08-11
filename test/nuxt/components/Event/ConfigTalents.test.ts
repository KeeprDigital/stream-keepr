import type { DropdownMenuItem } from '@nuxt/ui';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { createMockTalent } from '~~/test/helpers/fixtures';

const ALICE = createMockTalent({ id: 11, name: 'Alice' });
/** Two rows, one name: only their ids tell them apart. */
const BOB = createMockTalent({ id: 12, name: 'Bob' });
const BOB_AGAIN = createMockTalent({ id: 13, name: 'Bob' });

// The page guard reaches for the overlay and the router when it installs itself;
// mounted bare this component's registration is a no-op, and these only have to exist.
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({ open: () => ({ result: Promise.resolve(true) }) }),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});

const UCardStub = defineComponent({
	name: 'UCard',
	template: '<section><slot /><slot name="footer" /></section>',
});

const UIEmptyStateStub = defineComponent({
	name: 'UIEmptyState',
	template: '<p data-empty />',
});

const UInputStub = defineComponent({
	name: 'UInput',
	props: { modelValue: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
});

// The row's confirm and cancel controls carry an icon and no label, so the icon is
// the only thing a test can name them by.
const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		label: { type: String, required: false },
		icon: { type: String, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button :data-label="label" :data-icon="icon" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
});

// The row menu is where "Remove" lives. Exposing its items lets a test choose an
// action by name rather than by driving a popover open.
const UDropdownMenuStub = defineComponent({
	name: 'UDropdownMenu',
	props: { items: { type: Array, default: () => [] } },
	template: '<div data-menu><slot /></div>',
});

const UTooltipStub = defineComponent({
	name: 'UTooltip',
	template: '<div><slot /></div>',
});

const stubs = {
	UCard: UCardStub,
	UIEmptyState: UIEmptyStateStub,
	UInput: UInputStub,
	UButton: UButtonStub,
	UDropdownMenu: UDropdownMenuStub,
	UTooltip: UTooltipStub,
};

enableAutoUnmount(afterEach);

async function mountComponent(talents: ReturnType<typeof createMockTalent>[]) {
	const { default: ConfigTalents } = await import('../../../../app/components/Event/ConfigTalents.vue');

	return mount(ConfigTalents, {
		attachTo: document.body,
		props: { talents },
		global: { stubs },
	});
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

function rowMenus(wrapper: Wrapper) {
	return wrapper.findAllComponents(UDropdownMenuStub);
}

function chooseRowAction(wrapper: Wrapper, index: number, label: string) {
	const items = rowMenus(wrapper)[index]!.props('items') as DropdownMenuItem[];
	const action = items.find(item => item.label === label);
	if (!action)
		throw new Error(`Row ${index} offers no "${label}" action`);
	action.onSelect?.(new Event('select') as never);
}

function saveButton(wrapper: Wrapper) {
	return wrapper.findAll('[data-label="Save"]').at(-1)!;
}

/** Confirms the row edit currently open, whichever row that is. */
async function confirmEdit(wrapper: Wrapper) {
	await wrapper.get('[data-icon="i-lucide-check"]').trigger('click');
	await flushPromises();
}

function submitted(wrapper: Wrapper) {
	const events = wrapper.emitted('submit');
	if (!events?.length)
		throw new Error('The card emitted no submit');
	return events.at(-1)![0] as { id?: number; name: string }[];
}

describe('event config talents', () => {
	// Everything beneath this card is keyed on talent id — the FK the event holds,
	// and the binding data a Take resolves through. The card has to speak the same
	// language or the save has to guess, and guessing by name is what made a
	// duplicate unremovable.
	it('carries each row back with the id of the talent it came from', async () => {
		const wrapper = await mountComponent([ALICE, BOB]);
		await flushPromises();

		chooseRowAction(wrapper, 1, 'Remove');
		await flushPromises();
		await saveButton(wrapper).trigger('click');

		expect(submitted(wrapper)).toEqual([{ id: ALICE.id, name: 'Alice' }]);
	});

	it('distinguishes two namesakes when one is removed', async () => {
		const wrapper = await mountComponent([BOB, BOB_AGAIN]);
		await flushPromises();

		chooseRowAction(wrapper, 0, 'Remove');
		await flushPromises();
		await saveButton(wrapper).trigger('click');

		expect(submitted(wrapper)).toEqual([{ id: BOB_AGAIN.id, name: 'Bob' }]);
	});

	// A rename keeps the id, so the save can update the talent rather than replace
	// them — which is what used to clear their commentator seat.
	it('keeps the id when a name is edited', async () => {
		const wrapper = await mountComponent([ALICE]);
		await flushPromises();

		chooseRowAction(wrapper, 0, 'Edit Name');
		await flushPromises();

		await wrapper.getComponent(UInputStub).setValue('Alicia');
		await confirmEdit(wrapper);
		await saveButton(wrapper).trigger('click');

		expect(submitted(wrapper)).toEqual([{ id: ALICE.id, name: 'Alicia' }]);
	});

	it('offers a newly added row with no id at all', async () => {
		const wrapper = await mountComponent([ALICE]);
		await flushPromises();

		await wrapper.get('[data-label="Add talent"]').trigger('click');
		await flushPromises();

		await wrapper.getComponent(UInputStub).setValue('Dana');
		await confirmEdit(wrapper);
		await saveButton(wrapper).trigger('click');

		expect(submitted(wrapper)).toEqual([
			{ id: ALICE.id, name: 'Alice' },
			{ name: 'Dana' },
		]);
	});
});
