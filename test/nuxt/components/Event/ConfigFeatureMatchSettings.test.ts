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
 * the wire type drops and lacks `talents`. This card reads only the feature match
 * toggles, so the row stands in for the response.
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

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" />',
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

const componentPath = '../../../../app/components/Event/ConfigFeatureMatchSettings.vue';

const stubs = {
	UForm: UFormStub,
	UCard: UCardStub,
	UFormField: UFormFieldStub,
	USwitch: USwitchStub,
	UInput: UInputStub,
	UButton: UButtonStub,
};

// A detached button has no activation behaviour, so pressing a submit button
// only submits its form once the tree is in the document.
const mountOptions = { attachTo: document.body, global: { stubs } };

/** What the card sends when nothing has been touched, for a test to vary one key of. */
const UNTOUCHED_PAYLOAD = {
	pronounsEnabled: true,
	standingsEnabled: true,
	lgsEnabled: false,
	tableNumberEnabled: false,
	featureMatchDefaultTurnTrackingEnabled: false,
	featureMatchDefaultActivePlayerTrackingEnabled: false,
	featureMatchDefaultMulliganTrackingEnabled: false,
	featureMatchDefaultExtraTurnsLabel: 'Extra Turns',
};

enableAutoUnmount(afterEach);

async function mountComponent(event: Event = configEvent()) {
	const { default: ConfigFeatureMatchSettings } = await import(componentPath);

	return mount(ConfigFeatureMatchSettings, { ...mountOptions, props: { event } });
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/**
 * Mounts the card the way `pages/event/[eventId]/config/features.vue` does, inside
 * a page that has installed the unsaved-changes guard. See the shared harness for
 * why the registration is invisible from a bare mount.
 */
async function mountUnderGuard(event: Event = configEvent()) {
	const { default: ConfigFeatureMatchSettings } = await import(componentPath);

	return mountUnderPageGuard<Wrapper>(ConfigFeatureMatchSettings, { ...mountOptions, props: { event } });
}

function toggleFor(wrapper: Wrapper, field: string) {
	return wrapper.get(`[data-field="${field}"]`).getComponent(USwitchStub);
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

describe('event config feature match settings', () => {
	it('shows the toggles the event already carries', async () => {
		const wrapper = await mountComponent(configEvent({
			featureMatchDefaultTurnTrackingEnabled: true,
			lgsEnabled: true,
		}));
		await flushPromises();

		expect(toggleFor(wrapper, 'turnTrackingEnabled').props('modelValue')).toBe(true);
		expect(toggleFor(wrapper, 'lgsEnabled').props('modelValue')).toBe(true);
		expect(toggleFor(wrapper, 'pronounsEnabled').props('modelValue')).toBe(true);
		expect(toggleFor(wrapper, 'tableNumberEnabled').props('modelValue')).toBe(false);
	});

	// The extra turns label only means anything to an event that tracks extra
	// turns, so the field is offered only to one that does.
	it('offers the extra turns label only when the event tracks extra turns', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-field="extraTurnsLabel"]').exists()).toBe(false);

		const tracking = await mountComponent(configEvent({ featureMatchDefaultExtraTurnsEnabled: true }));
		await flushPromises();

		expect(tracking.get('[data-field="extraTurnsLabel"]').getComponent(UInputStub).props('modelValue')).toBe('Extra Turns');
	});

	// The guard is what stops an operator navigating away from an unsaved edit. It
	// registers through inject, so a card mounted without a page around it
	// registers with nothing and loses this silently.
	it('tells the page it has unsaved changes while its form is edited', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		expect(pageIsDirty()).toBe(false);

		await toggleFor(wrapper, 'turnTrackingEnabled').setValue(true);
		expect(pageIsDirty()).toBe(true);

		await resetButton(wrapper).trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	// The card speaks in short names and the API in flat `featureMatchDefault*`
	// columns, so the save has a mapping to get wrong.
	it('saves an edited toggle under its column name when the operator presses Save', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await toggleFor(wrapper, 'turnTrackingEnabled').setValue(true);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(submitted(wrapper)).toEqual({
			...UNTOUCHED_PAYLOAD,
			featureMatchDefaultTurnTrackingEnabled: true,
		});
	});

	it('saves an edited event-level toggle under its own name', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await toggleFor(wrapper, 'pronounsEnabled').setValue(false);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(submitted(wrapper)).toEqual({
			...UNTOUCHED_PAYLOAD,
			pronounsEnabled: false,
		});
	});
});
