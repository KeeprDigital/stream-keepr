import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent, createMockTalent } from '~~/test/helpers/fixtures';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import Controls from '~/components/Event/Controls.vue';

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

const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useToast', () => () => mockToast);

// The page guard needs these to install.
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: () => ({
			result: Promise.resolve(true),
		}),
	}),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});

// Attached, so pressing a form's Save — a submit button — submits it.
const mountOptions = {
	attachTo: document.body,
	global: { stubs: nuxtUiStubs },
};

enableAutoUnmount(afterEach);

async function mountComponent() {
	return mount(Controls, mountOptions);
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

async function mountUnderGuard() {
	return mountUnderPageGuard<Wrapper>(Controls, mountOptions);
}

/** The two forms are found by the field they carry, not by their order. */
function formFor(wrapper: Wrapper, field: string) {
	const form = wrapper.findAll('form').find(entry => entry.find(`[data-field="${field}"]`).exists());
	if (!form)
		throw new Error(`No form carrying the field "${field}"`);
	return form;
}

function holdingTextField(wrapper: Wrapper) {
	return wrapper.getComponent({ name: 'UTextarea' });
}

function commentatorField(wrapper: Wrapper, position: 1 | 2) {
	return wrapper.get(`[data-field="commentator${position}TalentId"]`).getComponent({ name: 'USelectMenu' });
}

function formButton(wrapper: Wrapper, field: string, label: string) {
	return formFor(wrapper, field).findAll('button').find(button => button.text() === label)!;
}

const saveButton = (wrapper: Wrapper, field: string) => formButton(wrapper, field, 'Save');
const resetButton = (wrapper: Wrapper, field: string) => formButton(wrapper, field, 'Reset');

/** Each form's own edit, for the cases both forms share. */
const FORMS = [
	{
		form: 'holding text',
		field: 'holdingText',
		other: 'commentator1TalentId',
		edit: (wrapper: Wrapper) => holdingTextField(wrapper).setValue('Back after this break.'),
		initial: (wrapper: Wrapper) => expect(holdingTextField(wrapper).props('modelValue')).toBe('Coverage resumes shortly.'),
	},
	{
		form: 'commentator',
		field: 'commentator1TalentId',
		other: 'holdingText',
		edit: (wrapper: Wrapper) => commentatorField(wrapper, 1).setValue(CASPAR.id),
		initial: (wrapper: Wrapper) => expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id),
	},
];

describe('event controls', () => {
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		mockEventStore.event = loadedEvent();
		mockEventStore.updateEvent.mockReset().mockResolvedValue(loadedEvent());
		mockEventStore.addTalent.mockReset().mockResolvedValue(createMockTalent({ id: 14, name: 'Dana' }));
		mockToast.add.mockClear();
		// Silenced, not asserted: the operator sees the toast.
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

		expect(commentatorField(wrapper, 1).props('items')).toEqual([
			{ label: 'Alice', value: ALICE.id },
			{ label: 'Caspar', value: CASPAR.id },
		]);
		expect(commentatorField(wrapper, 2).props('items')).toEqual([
			{ label: 'Briony', value: BRIONY.id },
			{ label: 'Caspar', value: CASPAR.id },
		]);
	});

	// Names differing only in case are one person to this form (#128), so the
	// exclusion works on names even though the form saves ids (#298).
	it('offers neither casing of a name already taken by the other position', async () => {
		mockEventStore.event = {
			...loadedEvent({ commentator2TalentId: null }),
			talents: [ALICE, ALICE_LOWERCASE, CASPAR],
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(commentatorField(wrapper, 1).props('modelValue')).toBe(ALICE.id);
		expect(commentatorField(wrapper, 2).props('items')).toEqual([
			{ label: 'Caspar', value: CASPAR.id },
		]);
		expect(commentatorField(wrapper, 1).props('items')).toHaveLength(3);
	});

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
			{ label: 'Caspar', value: CASPAR.id },
			{ label: 'Sam', value: SAM_ONE.id },
			{ label: 'Sam', value: SAM_TWO.id },
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

	// A dirty form still follows a colleague's change to a field it left alone (#612).
	it('keeps a colleague\'s change to the other position while this operator edits one', async () => {
		const DANA = createMockTalent({ id: 16, name: 'Dana' });
		const wrapper = await mountComponent();
		await flushPromises();

		await commentatorField(wrapper, 1).setValue(CASPAR.id);
		mockEventStore.event = {
			...loadedEvent({ commentator2TalentId: DANA.id }),
			talents: [CASPAR, ALICE, BRIONY, DANA],
		};
		await flushPromises();

		expect(commentatorField(wrapper, 2).props('modelValue')).toBe(DANA.id);

		await formFor(wrapper, 'commentator1TalentId').trigger('submit');
		await flushPromises();

		expect(mockEventStore.updateEvent).toHaveBeenCalledWith({ commentator1TalentId: CASPAR.id });
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

	it.each(FORMS)('sends an empty patch when the untouched $form form is saved', async ({ field }) => {
		const wrapper = await mountComponent();
		await flushPromises();

		await formFor(wrapper, field).trigger('submit');
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

	// USelectMenu re-emits `create` on every Enter while the request is in flight.
	it('creates one talent when the same name is offered twice before the first lands', async () => {
		const pending = deferred<unknown>();
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

	it.each(FORMS)('marks the $form form busy, and only it, while its request is in flight', async ({ field, other, edit }) => {
		const save = deferred<unknown>();
		mockEventStore.updateEvent.mockReturnValue(save.promise);
		const wrapper = await mountComponent();
		await flushPromises();

		await edit(wrapper);
		await formFor(wrapper, field).trigger('submit');
		await flushPromises();

		expect(saveButton(wrapper, field).attributes('aria-busy')).toBe('true');
		expect(saveButton(wrapper, other).attributes('aria-busy')).toBeUndefined();

		save.resolve(loadedEvent());
		await flushPromises();

		expect(saveButton(wrapper, field).attributes('aria-busy')).toBeUndefined();
	});

	it.each(FORMS)('offers a $form save only once that form has changed, and takes it back on reset', async ({ field, edit, initial }) => {
		const wrapper = await mountComponent();
		await flushPromises();
		expect(saveButton(wrapper, field).attributes('disabled')).toBeDefined();

		await edit(wrapper);
		expect(saveButton(wrapper, field).attributes('disabled')).toBeUndefined();

		await resetButton(wrapper, field).trigger('click');
		initial(wrapper);
		expect(saveButton(wrapper, field).attributes('disabled')).toBeDefined();
		expect(mockEventStore.updateEvent).not.toHaveBeenCalled();
	});

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

	it('reads clean once a holding text the save trimmed lands', async () => {
		mockEventStore.updateEvent.mockImplementation(async (updates: object) => {
			mockEventStore.event = {
				...mockEventStore.event!,
				...updates,
			};
			return mockEventStore.event;
		});
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		await holdingTextField(wrapper).setValue('Back after this break.  ');
		await saveButton(wrapper, 'holdingText').trigger('click');
		await flushPromises();

		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
		expect(holdingTextField(wrapper).props('modelValue')).toBe('Back after this break.');
		expect(saveButton(wrapper, 'holdingText').attributes('disabled')).toBeDefined();
		expect(pageIsDirty()).toBe(false);
	});
});
