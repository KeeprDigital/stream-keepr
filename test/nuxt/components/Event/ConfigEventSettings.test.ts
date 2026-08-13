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
 * the wire type drops and lacks `talents`. This card reads neither — only the
 * name and the game — so the row stands in for the response.
 */
function configEvent(overrides?: Parameters<typeof createMockEvent>[0]): Event {
	return createMockEvent({ name: 'Regional Championship', ...overrides }) as unknown as Event;
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

const UInputStub = defineComponent({
	name: 'UInput',
	props: { modelValue: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" />',
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

const componentPath = '../../../../app/components/Event/ConfigEventSettings.vue';

const stubs = {
	UForm: UFormStub,
	UCard: UCardStub,
	UFormField: UFormFieldStub,
	UInput: UInputStub,
	UBadge: { template: '<span><slot /></span>' },
	UButton: UButtonStub,
};

// A detached button has no activation behaviour, so pressing a submit button
// only submits its form once the tree is in the document.
const mountOptions = { attachTo: document.body, global: { stubs } };

enableAutoUnmount(afterEach);

async function mountComponent(event: Event = configEvent()) {
	const { default: ConfigEventSettings } = await import(componentPath);

	return mount(ConfigEventSettings, { ...mountOptions, props: { event } });
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/**
 * Mounts the card the way `pages/event/[eventId]/config.vue` does, inside a page
 * that has installed the unsaved-changes guard. See the shared harness for why
 * the registration is invisible from a bare mount.
 */
async function mountUnderGuard(event: Event = configEvent()) {
	const { default: ConfigEventSettings } = await import(componentPath);

	return mountUnderPageGuard<Wrapper>(ConfigEventSettings, { ...mountOptions, props: { event } });
}

function nameField(wrapper: Wrapper) {
	return wrapper.getComponent(UInputStub);
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

describe('event config event settings', () => {
	it('shows the name the event already carries', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(nameField(wrapper).props('modelValue')).toBe('Regional Championship');
	});

	// The guard is what stops an operator navigating away from an unsaved edit. It
	// registers through inject, so a card mounted without a page around it
	// registers with nothing and loses this silently.
	it('tells the page it has unsaved changes while its form is edited', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		expect(pageIsDirty()).toBe(false);

		await nameField(wrapper).setValue('Regional Championship 2026');
		expect(pageIsDirty()).toBe(true);

		await resetButton(wrapper).trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	it('saves the edited name when the operator presses Save', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await nameField(wrapper).setValue('Regional Championship 2026');
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(submitted(wrapper)).toEqual({ name: 'Regional Championship 2026' });
	});

	it('refuses to save a name the operator has emptied', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await nameField(wrapper).setValue('   ');
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(wrapper.emitted('submit')).toBeUndefined();
		expect(wrapper.get('[data-field="name"]').attributes('data-error')).toBe('Event name is required');
	});
});
