import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { createMockEvent, createMockTalent } from '~~/test/helpers/fixtures';

const ALICE = createMockTalent({ id: 11, name: 'Alice' });
const BRIONY = createMockTalent({ id: 12, name: 'Briony' });
const CASPAR = createMockTalent({ id: 13, name: 'Caspar' });

function loadedEvent(overrides?: Partial<ReturnType<typeof createMockEvent>>) {
	return {
		...createMockEvent({
			id: 1,
			holdingText: 'Coverage resumes shortly.',
			commentator1TalentId: ALICE.id,
			commentator2TalentId: BRIONY.id,
			...overrides,
		}),
		talents: [CASPAR, ALICE, BRIONY],
	};
}

const mockEventStore = reactive({
	event: null as ReturnType<typeof loadedEvent> | null,
	updateEvent: vi.fn(),
	addTalent: vi.fn(),
});

const mockToast = { add: vi.fn() };

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useToast', () => () => mockToast);

const UFormStub = defineComponent({
	name: 'UForm',
	props: { state: { type: Object, required: true } },
	emits: ['submit'],
	template: '<form :data-fields="Object.keys(state).join(\' \')" @submit.prevent="$emit(\'submit\')"><slot /></form>',
});

const UCardStub = defineComponent({
	name: 'UCard',
	props: { title: { type: String, required: false } },
	template: '<section><slot name="header" /><slot /><slot name="footer" /></section>',
});

const UFormFieldStub = defineComponent({
	name: 'UFormField',
	props: { name: { type: String, required: false } },
	template: '<label :data-field="name"><slot /></label>',
});

const UTextareaStub = defineComponent({
	name: 'UTextarea',
	props: { modelValue: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<textarea :value="modelValue" />',
});

const USelectMenuStub = defineComponent({
	name: 'USelectMenu',
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, default: () => [] },
	},
	emits: ['update:modelValue', 'create'],
	template: '<select :value="modelValue" />',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		loading: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :data-label="label" :disabled="disabled" :data-loading="loading" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});

async function mountComponent() {
	const componentPath = '../../../../app/components/Event/Controls.vue';
	const { default: Controls } = await import(componentPath);

	return mount(Controls, {
		global: {
			stubs: {
				UForm: UFormStub,
				UCard: UCardStub,
				UFormField: UFormFieldStub,
				UTextarea: UTextareaStub,
				USelectMenu: USelectMenuStub,
				UButton: UButtonStub,
			},
		},
	});
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/** The two forms are identified by the fields they carry, not by their order. */
function formFor(wrapper: Wrapper, field: string) {
	const form = wrapper.findAll('form')
		.find(entry => entry.attributes('data-fields')?.split(' ').includes(field));
	if (!form)
		throw new Error(`No form carrying the field "${field}"`);
	return form;
}

function holdingTextField(wrapper: Wrapper) {
	return wrapper.getComponent(UTextareaStub);
}

function commentatorField(wrapper: Wrapper, position: 1 | 2) {
	return wrapper.get(`[data-field="commentator${position}Name"]`)
		.getComponent(USelectMenuStub);
}

function saveButton(wrapper: Wrapper, field: string) {
	return formFor(wrapper, field).get('[data-label="Save"]');
}

function resetButton(wrapper: Wrapper, field: string) {
	return formFor(wrapper, field).get('[data-label="Reset"]');
}

/** A request the test holds open, so the in-flight state is observable. */
function deferred() {
	let resolve: (value: unknown) => void = () => {};
	const promise = new Promise<unknown>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe('event controls', () => {
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		mockEventStore.event = loadedEvent();
		mockEventStore.updateEvent.mockReset().mockResolvedValue(loadedEvent());
		mockEventStore.addTalent.mockReset().mockResolvedValue(createMockTalent({ id: 14, name: 'Dana' }));
		mockToast.add.mockClear();
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleError.mockRestore();
	});

	it('shows the holding text and commentators already saved on the event', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(holdingTextField(wrapper).props('modelValue')).toBe('Coverage resumes shortly.');
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe('Alice');
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe('Briony');
	});

	it('leaves a commentator position empty when the event has nobody assigned to it', async () => {
		mockEventStore.event = loadedEvent({ holdingText: null, commentator2TalentId: null });
		const wrapper = await mountComponent();
		await flushPromises();

		expect(holdingTextField(wrapper).props('modelValue')).toBe('');
		expect(commentatorField(wrapper, 2).props('modelValue')).toBeUndefined();
	});

	it('offers the event talents alphabetically, minus the one already in the other position', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(commentatorField(wrapper, 1).props('items')).toEqual(['Alice', 'Caspar']);
		expect(commentatorField(wrapper, 2).props('items')).toEqual(['Briony', 'Caspar']);
	});

	it('offers no controls until the event loads, then fills both forms from it', async () => {
		mockEventStore.event = null;
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.findAll('form')).toHaveLength(0);

		mockEventStore.event = loadedEvent();
		await flushPromises();

		expect(wrapper.findAll('form')).toHaveLength(2);
		expect(holdingTextField(wrapper).props('modelValue')).toBe('Coverage resumes shortly.');
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe('Alice');
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe('Briony');
	});

	it('saves an edited holding text, trimmed', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await holdingTextField(wrapper).setValue('  Back after this break.  ');
		await formFor(wrapper, 'holdingText').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ holdingText: 'Back after this break.' });
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			description: 'Holding text updated',
			color: 'success',
		}));
	});

	it('clears the holding text when the operator empties the message', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await holdingTextField(wrapper).setValue('   ');
		await formFor(wrapper, 'holdingText').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ holdingText: null });
	});

	it('saves commentators as the talent ids behind the chosen names', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await commentatorField(wrapper, 1).setValue('Caspar');
		await formFor(wrapper, 'commentator1Name').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ commentator1TalentId: CASPAR.id });
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			description: 'Commentators updated',
			color: 'success',
		}));
	});

	it('unassigns a commentator when the operator clears the position', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await commentatorField(wrapper, 2).setValue(undefined);
		await formFor(wrapper, 'commentator2Name').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ commentator2TalentId: null });
	});

	it('sends an empty patch when the untouched commentator form is saved', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await formFor(wrapper, 'commentator1Name').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({});
	});

	it('sends an empty patch when the untouched holding text form is saved', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await formFor(wrapper, 'holdingText').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({});
	});

	it('swaps the two commentators without touching the event until the form is saved', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.get('[aria-label="Swap commentators"]').trigger('click');

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe('Briony');
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe('Alice');
		expect(mockEventStore.updateEvent).not.toHaveBeenCalled();

		await formFor(wrapper, 'commentator1Name').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({
			commentator1TalentId: BRIONY.id,
			commentator2TalentId: ALICE.id,
		});
	});

	it('creates a new talent and puts them in the position that asked for them', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 2).vm.$emit('create', '  Dana  ');
		await flushPromises();

		expect(mockEventStore.addTalent).toHaveBeenCalledWith({ name: 'Dana' });
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe('Dana');
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe('Alice');
	});

	// The store appends the created Talent to the Event, but until that lands the
	// name in the form resolves to no id at all — the save must not invent one.
	it('assigns nobody when a just-created commentator has not reached the event yet', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 1).vm.$emit('create', 'Dana');
		await flushPromises();
		await formFor(wrapper, 'commentator1Name').trigger('submit');
		await flushPromises();

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe('Dana');
		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ commentator1TalentId: null });
	});

	it('ignores a blank name offered as a new commentator', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 1).vm.$emit('create', '   ');
		await flushPromises();

		expect(mockEventStore.addTalent).not.toHaveBeenCalled();
	});

	it('reports a failed talent creation and leaves the position as it was', async () => {
		mockEventStore.addTalent.mockResolvedValue(null);
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 1).vm.$emit('create', 'Dana');
		await flushPromises();

		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			description: 'Failed to create commentator',
			color: 'error',
		}));
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe('Alice');
	});

	it('reports a failed holding text save and keeps the operator edit on screen', async () => {
		mockEventStore.updateEvent.mockResolvedValue(null);
		const wrapper = await mountComponent();
		await flushPromises();

		await holdingTextField(wrapper).setValue('Back after this break.');
		await formFor(wrapper, 'holdingText').trigger('submit');
		await flushPromises();

		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			description: 'Failed to save holding text',
			color: 'error',
		}));
		expect(mockToast.add).not.toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
		expect(holdingTextField(wrapper).props('modelValue')).toBe('Back after this break.');
	});

	it('reports a commentator save that throws', async () => {
		mockEventStore.updateEvent.mockRejectedValue(new Error('network down'));
		const wrapper = await mountComponent();
		await flushPromises();

		await commentatorField(wrapper, 1).setValue('Caspar');
		await formFor(wrapper, 'commentator1Name').trigger('submit');
		await flushPromises();

		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			description: 'Failed to save commentators',
			color: 'error',
		}));
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe('Caspar');
	});

	it('marks the holding text form busy, and only it, while its request is in flight', async () => {
		const save = deferred();
		mockEventStore.updateEvent.mockReturnValue(save.promise);
		const wrapper = await mountComponent();
		await flushPromises();

		await holdingTextField(wrapper).setValue('Back after this break.');
		await formFor(wrapper, 'holdingText').trigger('submit');
		await wrapper.vm.$nextTick();

		expect(saveButton(wrapper, 'holdingText').attributes('data-loading')).toBe('true');
		expect(saveButton(wrapper, 'commentator1Name').attributes('data-loading')).toBe('false');

		save.resolve(loadedEvent());
		await flushPromises();

		expect(saveButton(wrapper, 'holdingText').attributes('data-loading')).toBe('false');
	});

	it('marks the commentator form busy, and only it, while its request is in flight', async () => {
		const save = deferred();
		mockEventStore.updateEvent.mockReturnValue(save.promise);
		const wrapper = await mountComponent();
		await flushPromises();

		await commentatorField(wrapper, 1).setValue('Caspar');
		await formFor(wrapper, 'commentator1Name').trigger('submit');
		await wrapper.vm.$nextTick();

		expect(saveButton(wrapper, 'commentator1Name').attributes('data-loading')).toBe('true');
		expect(saveButton(wrapper, 'holdingText').attributes('data-loading')).toBe('false');

		save.resolve(loadedEvent());
		await flushPromises();

		expect(saveButton(wrapper, 'commentator1Name').attributes('data-loading')).toBe('false');
	});

	it('offers a holding text save only once that form has changed, and takes it back on reset', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(saveButton(wrapper, 'holdingText').attributes('disabled')).toBeDefined();

		await holdingTextField(wrapper).setValue('Back after this break.');
		expect(saveButton(wrapper, 'holdingText').attributes('disabled')).toBeUndefined();

		await resetButton(wrapper, 'holdingText').trigger('click');

		expect(holdingTextField(wrapper).props('modelValue')).toBe('Coverage resumes shortly.');
		expect(saveButton(wrapper, 'holdingText').attributes('disabled')).toBeDefined();
		expect(mockEventStore.updateEvent).not.toHaveBeenCalled();
	});

	it('offers a commentator save only once that form has changed, and takes it back on reset', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(saveButton(wrapper, 'commentator1Name').attributes('disabled')).toBeDefined();

		await commentatorField(wrapper, 1).setValue('Caspar');
		expect(saveButton(wrapper, 'commentator1Name').attributes('disabled')).toBeUndefined();

		await resetButton(wrapper, 'commentator1Name').trigger('click');

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe('Alice');
		expect(saveButton(wrapper, 'commentator1Name').attributes('disabled')).toBeDefined();
		expect(mockEventStore.updateEvent).not.toHaveBeenCalled();
	});
});
