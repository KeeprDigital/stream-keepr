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
 * the wire type drops and lacks `talents`. This card reads only the three display
 * settings, so the row stands in for the response.
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
	props: { name: { type: String, required: false } },
	template: '<label :data-field="name"><slot /></label>',
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

const componentPath = '../../../../app/components/Event/ConfigApiSettings.vue';

const stubs = {
	UForm: UFormStub,
	UCard: UCardStub,
	UFormField: UFormFieldStub,
	USelect: USelectStub,
	USwitch: USwitchStub,
	USeparator: true,
	UButton: UButtonStub,
};

// A detached button has no activation behaviour, so pressing a submit button
// only submits its form once the tree is in the document.
const mountOptions = { attachTo: document.body, global: { stubs } };

enableAutoUnmount(afterEach);

async function mountComponent(event: Event = configEvent()) {
	const { default: ConfigApiSettings } = await import(componentPath);

	return mount(ConfigApiSettings, { ...mountOptions, props: { event } });
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/**
 * Mounts the card the way `pages/event/[eventId]/config.vue` does, inside a page
 * that has installed the unsaved-changes guard. See the shared harness for why
 * the registration is invisible from a bare mount.
 */
async function mountUnderGuard(event: Event = configEvent()) {
	const { default: ConfigApiSettings } = await import(componentPath);

	return mountUnderPageGuard<Wrapper>(ConfigApiSettings, { ...mountOptions, props: { event } });
}

function selectFor(wrapper: Wrapper, field: string) {
	return wrapper.get(`[data-field="${field}"]`).getComponent(USelectStub);
}

function hideZeroDrawsSwitch(wrapper: Wrapper) {
	return wrapper.get('[data-field="displayHideZeroDraws"]').getComponent(USwitchStub);
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

describe('event config api settings', () => {
	it('shows the display settings the event already carries', async () => {
		const wrapper = await mountComponent(configEvent({
			displayRecordSeparator: '/',
			displayPositionFormat: 'number',
		}));
		await flushPromises();

		expect(selectFor(wrapper, 'displayRecordSeparator').props('modelValue')).toBe('/');
		expect(selectFor(wrapper, 'displayPositionFormat').props('modelValue')).toBe('number');
		expect(hideZeroDrawsSwitch(wrapper).props('modelValue')).toBe(true);
	});

	// The guard is what stops an operator navigating away from an unsaved edit. It
	// registers through inject, so a card mounted without a page around it
	// registers with nothing and loses this silently.
	it('tells the page it has unsaved changes while its form is edited', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		expect(pageIsDirty()).toBe(false);

		await hideZeroDrawsSwitch(wrapper).setValue(false);
		expect(pageIsDirty()).toBe(true);

		await resetButton(wrapper).trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	it('saves the edited display settings when the operator presses Save', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await selectFor(wrapper, 'displayRecordSeparator').setValue('/');
		await hideZeroDrawsSwitch(wrapper).setValue(false);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(submitted(wrapper)).toEqual({
			displayRecordSeparator: '/',
			displayHideZeroDraws: false,
			displayPositionFormat: 'ordinal',
		});
	});

	it('offers a save only once the form has changed, and takes it back on reset', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();

		await hideZeroDrawsSwitch(wrapper).setValue(false);
		expect(saveButton(wrapper).attributes('disabled')).toBeUndefined();

		await resetButton(wrapper).trigger('click');

		expect(hideZeroDrawsSwitch(wrapper).props('modelValue')).toBe(true);
		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
		expect(wrapper.emitted('submit')).toBeUndefined();
	});
});
