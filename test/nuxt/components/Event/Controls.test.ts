import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { createMockEvent, createMockTalent } from '~~/test/helpers/fixtures';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';

const ALICE = createMockTalent({ id: 11, name: 'Alice' });
const BRIONY = createMockTalent({ id: 12, name: 'Briony' });
const CASPAR = createMockTalent({ id: 13, name: 'Caspar' });
/** Talent names carry no uniqueness constraint, so this one can coexist with Alice. */
const ALICE_LOWERCASE = createMockTalent({ id: 15, name: 'alice' });

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

// The page guard reaches for the overlay and the router when it installs itself.
// What it does with them is its own composable's test; here they only have to
// exist so a test can mount this component the way its page does.
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({ open: () => ({ result: Promise.resolve(true) }) }),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});

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
		modelValue: { type: Number, required: false },
		items: { type: Array, default: () => [] },
	},
	emits: ['update:modelValue', 'create'],
	template: '<select :value="modelValue" />',
});

// UButton takes `type` as a prop and leaves the default to ULink, which is
// "button". Declaring it here rather than hardcoding one on the root says that
// out loud: attribute fallthrough would deliver the footer's "submit" either
// way, but only by accident of the root element having nothing else to say.
const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		loading: { type: Boolean, required: false },
		type: { type: String, required: false, default: 'button' },
	},
	emits: ['click'],
	template: '<button :type="type" :data-label="label" :disabled="disabled" :data-loading="loading" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});

const componentPath = '../../../../app/components/Event/Controls.vue';

const stubs = {
	UForm: UFormStub,
	UCard: UCardStub,
	UFormField: UFormFieldStub,
	UTextarea: UTextareaStub,
	USelectMenu: USelectMenuStub,
	UButton: UButtonStub,
};

// A detached button has no activation behaviour, so pressing a submit button
// only submits its form once the tree is in the document.
const mountOptions = { attachTo: document.body, global: { stubs } };

enableAutoUnmount(afterEach);

async function mountComponent() {
	const { default: Controls } = await import(componentPath);

	return mount(Controls, mountOptions);
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/**
 * Mounts the component the way `pages/event/[eventId]/index.vue` does, inside a
 * page that has installed the unsaved-changes guard. See the shared harness for
 * why the registration is invisible from a bare mount.
 */
async function mountUnderGuard() {
	const { default: Controls } = await import(componentPath);

	return mountUnderPageGuard<Wrapper>(Controls, mountOptions);
}

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
	return wrapper.get(`[data-field="commentator${position}TalentId"]`)
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
		// Silenced, deliberately not asserted: what an operator sees of a failure is
		// the toast, and every failure site pins that. The console call is the
		// mechanism, and asserting it would pin the mechanism instead.
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleError.mockRestore();
	});

	it('shows the holding text and commentators already saved on the event', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(holdingTextField(wrapper).props('modelValue')).toBe('Coverage resumes shortly.');
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id);
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe(BRIONY.id);
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

		expect(commentatorField(wrapper, 1).props('items')).toEqual([{ label: 'Alice', id: ALICE.id }, { label: 'Caspar', id: CASPAR.id }]);
		expect(commentatorField(wrapper, 2).props('items')).toEqual([{ label: 'Briony', id: BRIONY.id }, { label: 'Caspar', id: CASPAR.id }]);
	});

	// Two talents whose names differ only in case are two rows in the database and
	// one person to this form (#128). The form addresses talents by id since
	// #298, but the exclusion deliberately still works on names: hiding only the
	// selected row would offer the same person under their other casing.
	it('offers neither casing of a name already taken by the other position', async () => {
		mockEventStore.event = {
			...loadedEvent({ commentator2TalentId: null }),
			talents: [ALICE, ALICE_LOWERCASE, CASPAR],
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id);
		expect(commentatorField(wrapper, 2).props('items')).toEqual([{ label: 'Caspar', id: CASPAR.id }]);
		expect(commentatorField(wrapper, 1).props('items')).toHaveLength(3);
	});

	// #298's other half: two talents with the exact same name used to collapse to
	// one Map entry, so either choice saved whichever id the Map kept last. Ids
	// keep them apart — each option is one row, and the save sends the chosen one.
	it('keeps two identically named talents apart, saving the id the operator chose', async () => {
		const SAM_ONE = createMockTalent({ id: 21, name: 'Sam' });
		const SAM_TWO = createMockTalent({ id: 22, name: 'Sam' });
		mockEventStore.event = {
			...loadedEvent({ commentator1TalentId: null, commentator2TalentId: null }),
			talents: [SAM_ONE, SAM_TWO, CASPAR],
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(commentatorField(wrapper, 1).props('items')).toEqual([
			{ label: 'Caspar', id: CASPAR.id },
			{ label: 'Sam', id: SAM_ONE.id },
			{ label: 'Sam', id: SAM_TWO.id },
		]);

		await commentatorField(wrapper, 1).setValue(SAM_TWO.id);
		await formFor(wrapper, 'commentator1TalentId').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ commentator1TalentId: SAM_TWO.id });
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
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id);
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe(BRIONY.id);
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

	it('saves the holding text when the operator presses Save', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await holdingTextField(wrapper).setValue('Back after this break.');
		await saveButton(wrapper, 'holdingText').trigger('click');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ holdingText: 'Back after this break.' });
	});

	it('submits only the form whose Save was pressed, with both offering one', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await holdingTextField(wrapper).setValue('Back after this break.');
		await commentatorField(wrapper, 1).setValue(CASPAR.id);
		await saveButton(wrapper, 'commentator1TalentId').trigger('click');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledTimes(1);
		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ commentator1TalentId: CASPAR.id });
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

		await commentatorField(wrapper, 1).setValue(CASPAR.id);
		await formFor(wrapper, 'commentator1TalentId').trigger('submit');
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
		await formFor(wrapper, 'commentator2TalentId').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ commentator2TalentId: null });
	});

	it('sends an empty patch when the untouched commentator form is saved', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await formFor(wrapper, 'commentator1TalentId').trigger('submit');
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

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(BRIONY.id);
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe(ALICE.id);
		expect(mockEventStore.updateEvent).not.toHaveBeenCalled();

		await formFor(wrapper, 'commentator1TalentId').trigger('submit');
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
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe(14);
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id);
	});

	// The form holds the created talent's id the moment the request lands (#298),
	// so the save assigns them even if the store's talent list has not caught up —
	// before ids, the name resolved to nothing and the save silently assigned
	// nobody.
	it('assigns a just-created commentator even before they reach the event talents', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 1).vm.$emit('create', 'Dana');
		await flushPromises();
		await formFor(wrapper, 'commentator1TalentId').trigger('submit');
		await flushPromises();

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(14);
		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ commentator1TalentId: 14 });
	});

	// USelectMenu re-emits `create` for every Enter while its create item is on
	// screen, and that item stays there for as long as the request is in flight —
	// so a second Enter arrives before the first talent exists to filter it away.
	// Talent names carry no uniqueness constraint, so the second call would land a
	// second row for one person.
	it('creates one talent when the same name is offered twice before the first lands', async () => {
		const pending = deferred();
		mockEventStore.addTalent.mockReturnValue(pending.promise);
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 1).vm.$emit('create', 'Dana');
		commentatorField(wrapper, 1).vm.$emit('create', 'Dana');
		await flushPromises();

		expect(mockEventStore.addTalent).toHaveBeenCalledTimes(1);

		pending.resolve(createMockTalent({ id: 14, name: 'Dana' }));
		await flushPromises();

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(14);
	});

	it('creates again once the first request has settled', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 1).vm.$emit('create', 'Dana');
		await flushPromises();

		mockEventStore.addTalent.mockResolvedValue(createMockTalent({ id: 16, name: 'Elias' }));
		commentatorField(wrapper, 2).vm.$emit('create', 'Elias');
		await flushPromises();

		expect(mockEventStore.addTalent).toHaveBeenCalledTimes(2);
		expect(commentatorField(wrapper, 2).props('modelValue')).toBe(16);
	});

	// The other position's name is filtered out of this one's options, so typing it
	// here leaves nothing to match and USelectMenu offers to create it instead. The
	// offer is the component's own exclusion talking, not a missing talent.
	it('declines to duplicate a talent already holding the other position', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 1).vm.$emit('create', 'Briony');
		await flushPromises();

		expect(mockEventStore.addTalent).not.toHaveBeenCalled();
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id);
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			description: 'Briony is already assigned to the other commentator position',
			color: 'error',
		}));
	});

	// Whatever route produced the offer, a name the event already holds names a
	// talent that already exists — adopt them rather than minting a namesake.
	it('adopts an existing talent offered for creation, whatever its casing', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		commentatorField(wrapper, 1).vm.$emit('create', 'caspar');
		await flushPromises();

		expect(mockEventStore.addTalent).not.toHaveBeenCalled();
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(CASPAR.id);
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
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id);
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

		await commentatorField(wrapper, 1).setValue(CASPAR.id);
		await formFor(wrapper, 'commentator1TalentId').trigger('submit');
		await flushPromises();

		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			description: 'Failed to save commentators',
			color: 'error',
		}));
		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(CASPAR.id);
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
		expect(saveButton(wrapper, 'commentator1TalentId').attributes('data-loading')).toBe('false');

		save.resolve(loadedEvent());
		await flushPromises();

		expect(saveButton(wrapper, 'holdingText').attributes('data-loading')).toBe('false');
	});

	it('marks the commentator form busy, and only it, while its request is in flight', async () => {
		const save = deferred();
		mockEventStore.updateEvent.mockReturnValue(save.promise);
		const wrapper = await mountComponent();
		await flushPromises();

		await commentatorField(wrapper, 1).setValue(CASPAR.id);
		await formFor(wrapper, 'commentator1TalentId').trigger('submit');
		await wrapper.vm.$nextTick();

		expect(saveButton(wrapper, 'commentator1TalentId').attributes('data-loading')).toBe('true');
		expect(saveButton(wrapper, 'holdingText').attributes('data-loading')).toBe('false');

		save.resolve(loadedEvent());
		await flushPromises();

		expect(saveButton(wrapper, 'commentator1TalentId').attributes('data-loading')).toBe('false');
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

	// The guard is what stops an operator navigating away from an unsaved edit. It
	// registers through inject, so a component mounted without a page around it
	// registers with nothing and loses this silently.
	it('tells the page it has unsaved changes while either form is edited', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		expect(pageIsDirty()).toBe(false);

		await holdingTextField(wrapper).setValue('Back after this break.');
		expect(pageIsDirty()).toBe(true);

		await resetButton(wrapper, 'holdingText').trigger('click');
		expect(pageIsDirty()).toBe(false);

		await commentatorField(wrapper, 1).setValue(CASPAR.id);
		expect(pageIsDirty()).toBe(true);

		await resetButton(wrapper, 'commentator1TalentId').trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	it('offers a commentator save only once that form has changed, and takes it back on reset', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(saveButton(wrapper, 'commentator1TalentId').attributes('disabled')).toBeDefined();

		await commentatorField(wrapper, 1).setValue(CASPAR.id);
		expect(saveButton(wrapper, 'commentator1TalentId').attributes('disabled')).toBeUndefined();

		await resetButton(wrapper, 'commentator1TalentId').trigger('click');

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id);
		expect(saveButton(wrapper, 'commentator1TalentId').attributes('disabled')).toBeDefined();
		expect(mockEventStore.updateEvent).not.toHaveBeenCalled();
	});
});
