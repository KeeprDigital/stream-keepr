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
 * the wire type drops and lacks `talents`. This card reads only the three
 * broadcast settings, so the row stands in for the response.
 */
function configEvent(overrides?: Parameters<typeof createMockEvent>[0]): Event {
	return createMockEvent({ numFeatureMatches: 2, cardTimeout: 10, ...overrides }) as unknown as Event;
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

// `min` and `max` are declared so they stop at the stub instead of falling
// through onto a bare `<input type="number">`. Left to fall through they become
// real constraints, and happy-dom then refuses to submit the form at all — so a
// test for the card's own out-of-range complaint would never reach the code that
// makes it, and would pass on the strength of a submit that never happened.
const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		min: { type: Number, required: false },
		max: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
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

const componentPath = '../../../../app/components/Event/ConfigBroadcastSettings.vue';

const stubs = {
	UForm: UFormStub,
	UCard: UCardStub,
	UFormField: UFormFieldStub,
	USelect: USelectStub,
	UInputNumber: UInputNumberStub,
	UButton: UButtonStub,
};

// A detached button has no activation behaviour, so pressing a submit button
// only submits its form once the tree is in the document.
const mountOptions = { attachTo: document.body, global: { stubs } };

enableAutoUnmount(afterEach);

async function mountComponent(event: Event = configEvent()) {
	const { default: ConfigBroadcastSettings } = await import(componentPath);

	return mount(ConfigBroadcastSettings, { ...mountOptions, props: { event } });
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/**
 * Mounts the card the way `pages/event/[eventId]/config.vue` does, inside a page
 * that has installed the unsaved-changes guard. See the shared harness for why
 * the registration is invisible from a bare mount.
 */
async function mountUnderGuard(event: Event = configEvent()) {
	const { default: ConfigBroadcastSettings } = await import(componentPath);

	return mountUnderPageGuard<Wrapper>(ConfigBroadcastSettings, { ...mountOptions, props: { event } });
}

function numberFor(wrapper: Wrapper, field: string) {
	return wrapper.get(`[data-field="${field}"]`).getComponent(UInputNumberStub);
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

describe('event config broadcast settings', () => {
	it('shows the broadcast settings the event already carries', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(numberFor(wrapper, 'numFeatureMatches').props('modelValue')).toBe(2);
		expect(numberFor(wrapper, 'cardTimeout').props('modelValue')).toBe(10);
		expect(wrapper.get('[data-field="featureMatchOrientation"]').getComponent(USelectStub).props('modelValue')).toBe('horizontal');
	});

	// The guard is what stops an operator navigating away from an unsaved edit. It
	// registers through inject, so a card mounted without a page around it
	// registers with nothing and loses this silently.
	it('tells the page it has unsaved changes while its form is edited', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		expect(pageIsDirty()).toBe(false);

		await numberFor(wrapper, 'cardTimeout').setValue(30);
		expect(pageIsDirty()).toBe(true);

		await resetButton(wrapper).trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	it('saves the edited broadcast settings when the operator presses Save', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await numberFor(wrapper, 'cardTimeout').setValue(30);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(submitted(wrapper)).toEqual({
			numFeatureMatches: 2,
			featureMatchOrientation: 'horizontal',
			cardTimeout: 30,
		});
	});

	it('refuses to save a negative card timeout, and says so at the field', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await numberFor(wrapper, 'cardTimeout').setValue(-1);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(wrapper.emitted('submit')).toBeUndefined();
		expect(errorFor(wrapper, 'cardTimeout')).toBe('Card timeout must be 0 or greater');
	});

	it('refuses to save more feature matches than the event can hold', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await numberFor(wrapper, 'numFeatureMatches').setValue(11);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(wrapper.emitted('submit')).toBeUndefined();
		expect(errorFor(wrapper, 'numFeatureMatches')).toBe('Cannot exceed 10 feature matches');
	});

	// The validation errors are the card's own, so a reset has to clear them
	// alongside the values that produced them.
	it('clears a validation complaint when the operator resets the form', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await numberFor(wrapper, 'cardTimeout').setValue(-1);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		await resetButton(wrapper).trigger('click');

		expect(errorFor(wrapper, 'cardTimeout')).toBeUndefined();
		expect(numberFor(wrapper, 'cardTimeout').props('modelValue')).toBe(10);
	});
});
