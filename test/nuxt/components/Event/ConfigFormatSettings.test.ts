import type { Event } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';

// The page guard reaches for the overlay and the router when it installs itself.
// What it does with them is its own composable's test; here they only have to
// exist so a test can mount this card the way its page does.
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({ open: () => ({ result: Promise.resolve(true) }) }),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});

/**
 * The factory returns a database row, which carries the Melee credential columns
 * the wire type drops and lacks `talents`. This card reads only the match format
 * defaults and the points system, so the row stands in for the response.
 */
function configEvent(overrides?: Parameters<typeof createMockEvent>[0]): Event {
	return createMockEvent(overrides) as unknown as Event;
}

const UFormStub = defineComponent({
	name: 'UForm',
	props: { state: { type: Object, required: true } },
	emits: ['submit'],
	template: '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
});

const UCardStub = defineComponent({
	name: 'UCard',
	template: '<section><slot name="header" /><slot /><slot name="footer" /></section>',
});

const UFormFieldStub = defineComponent({
	name: 'UFormField',
	props: { name: { type: String, required: false }, error: { type: String, required: false } },
	template: '<label :data-field="name" :data-error="error"><slot /></label>',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: [String, Number], required: false },
		items: { type: Array, default: () => [] },
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" />',
});

// `min` is declared so it stops at the stub instead of falling through onto a
// bare `<input type="number">`. Left to fall through it becomes a real
// constraint, and happy-dom then refuses to submit the form at all — so a test
// for the card's own out-of-range complaint would never reach the code that
// makes it, and would pass on the strength of a submit that never happened.
const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		min: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" />',
});

// UButton takes `type` as a prop and leaves the default to ULink, which is
// "button". Declaring it here rather than hardcoding one on the root says that
// out loud: the footer's "submit" has to reach the rendered button for pressing
// Save to submit anything.
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

const componentPath = '../../../../app/components/Event/ConfigFormatSettings.vue';

const stubs = {
	UForm: UFormStub,
	UCard: UCardStub,
	UFormField: UFormFieldStub,
	USelect: USelectStub,
	UInputNumber: UInputNumberStub,
	USwitch: USwitchStub,
	USeparator: true,
	UButton: UButtonStub,
};

// A detached button has no activation behaviour, so pressing a submit button
// only submits its form once the tree is in the document.
const mountOptions = { attachTo: document.body, global: { stubs } };

/** What the card sends when nothing has been touched, for a test to vary one key of. */
const UNTOUCHED_PAYLOAD = {
	featureMatchDefaultBestOf: 3,
	featureMatchDefaultStartingLife: 20,
	featureMatchDefaultClockType: 'countdown',
	featureMatchDefaultClockDuration: 50,
	featureMatchDefaultCountUpAfterCountdown: false,
	featureMatchDefaultExtraTurnsEnabled: false,
	featureMatchDefaultExtraTurns: 5,
	pointsSystem: null,
};

enableAutoUnmount(afterEach);

async function mountComponent(event: Event = configEvent()) {
	const { default: ConfigFormatSettings } = await import(componentPath);

	return mount(ConfigFormatSettings, { ...mountOptions, props: { event } });
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/**
 * Mounts the card the way `pages/event/[eventId]/config/index.vue` does, inside a
 * page that has installed the unsaved-changes guard. See the shared harness for
 * why the registration is invisible from a bare mount.
 */
async function mountUnderGuard(event: Event = configEvent()) {
	const { default: ConfigFormatSettings } = await import(componentPath);

	return mountUnderPageGuard<Wrapper>(ConfigFormatSettings, { ...mountOptions, props: { event } });
}

function numberFor(wrapper: Wrapper, field: string) {
	return wrapper.get(`[data-field="${field}"]`).getComponent(UInputNumberStub);
}

function selectFor(wrapper: Wrapper, field: string) {
	return wrapper.get(`[data-field="${field}"]`).getComponent(USelectStub);
}

function errorFor(wrapper: Wrapper, field: string) {
	return wrapper.get(`[data-field="${field}"]`).attributes('data-error');
}

function saveButton(wrapper: Wrapper) {
	return wrapper.get('[data-label="Save"]');
}

function resetButton(wrapper: Wrapper) {
	return wrapper.get('[data-label="Reset"]');
}

function submitted(wrapper: Wrapper) {
	const events = wrapper.emitted('submit');
	if (!events?.length)
		throw new Error('The card emitted no submit');
	return events.at(-1)![0];
}

describe('event config format settings', () => {
	it('shows the match format the event already carries', async () => {
		const wrapper = await mountComponent(configEvent({ featureMatchDefaultClockDuration: 45 }));
		await flushPromises();

		expect(selectFor(wrapper, 'bestOf').props('modelValue')).toBe(3);
		expect(numberFor(wrapper, 'startingLife').props('modelValue')).toBe(20);
		expect(numberFor(wrapper, 'clockDuration').props('modelValue')).toBe(45);
		expect(selectFor(wrapper, 'clockType').props('modelValue')).toBe('countdown');
	});

	// The extra turns count is meaningless while extra turns are off, so the card
	// offers it only once the operator turns them on.
	it('offers the extra turns count only once extra turns are enabled', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-field="extraTurns"]').exists()).toBe(false);

		await wrapper.get('[data-field="extraTurnsEnabled"]').getComponent(USwitchStub).setValue(true);

		expect(numberFor(wrapper, 'extraTurns').props('modelValue')).toBe(5);
	});

	// The points system is an MTG concept, so a One Piece event is never offered it.
	it('offers the points system only to an MTG event', async () => {
		const wrapper = await mountComponent(configEvent({ game: 'op' }));
		await flushPromises();

		expect(wrapper.find('[data-field="pointsSystem"]').exists()).toBe(false);

		const mtg = await mountComponent();
		await flushPromises();

		expect(mtg.find('[data-field="pointsSystem"]').exists()).toBe(true);
	});

	// The guard is what stops an operator navigating away from an unsaved edit. It
	// registers through inject, so a card mounted without a page around it
	// registers with nothing and loses this silently.
	it('tells the page it has unsaved changes while its form is edited', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		expect(pageIsDirty()).toBe(false);

		await numberFor(wrapper, 'startingLife').setValue(40);
		expect(pageIsDirty()).toBe(true);

		await resetButton(wrapper).trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	// The card speaks in short names and the API in flat `featureMatchDefault*`
	// columns, so the save has a mapping to get wrong.
	it('saves an edited match format under its column names when the operator presses Save', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await numberFor(wrapper, 'startingLife').setValue(40);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(submitted(wrapper)).toEqual({
			...UNTOUCHED_PAYLOAD,
			featureMatchDefaultStartingLife: 40,
		});
	});

	// The points system is the event's own column rather than a match default, so
	// it rides alongside the mapped ones untranslated.
	it('saves the points system beside the mapped match defaults', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await selectFor(wrapper, 'pointsSystem').setValue('7ph');
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(submitted(wrapper)).toEqual({
			...UNTOUCHED_PAYLOAD,
			pointsSystem: '7ph',
		});
	});

	it('refuses to save a negative starting life, and says so at the field', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await numberFor(wrapper, 'startingLife').setValue(-1);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(wrapper.emitted('submit')).toBeUndefined();
		expect(errorFor(wrapper, 'startingLife')).toBe('Starting life must be 0 or greater');
	});
});
