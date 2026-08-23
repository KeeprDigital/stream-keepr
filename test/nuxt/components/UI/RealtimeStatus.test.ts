import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';

const UPopoverStub = defineComponent({
	template: '<div><slot /><slot name="content" /></div>',
});

const UIconStub = defineComponent({
	props: { name: { type: String, required: true } },
	template: '<i :data-icon="name" :class="$attrs.class" />',
});

const connectionState = ref('connected');
const isConnected = ref(true);
const tokenError = ref<Error | null>(null);

mockNuxtImport('tryUseRealtime', () => () => ({
	get connectionState() { return connectionState.value; },
	get isConnected() { return isConnected.value; },
	get tokenError() { return tokenError.value; },
}));

async function mountStatus() {
	const componentPath = '../../../../app/components/UI/RealtimeStatus.vue';
	const { default: RealtimeStatus } = await import(componentPath);

	return mount(RealtimeStatus, {
		global: { stubs: { UPopover: UPopoverStub, UIcon: UIconStub } },
	});
}

/**
 * The surface a token this client cannot mint has, now that it has one.
 *
 * A failed mint leaves the socket connected and the page looking healthy while
 * every channel for the Event the operator just switched to is unsubscribable.
 * Before #307 that was reported by a single `console.warn` — which is not a
 * surface anyone running a show is looking at — and recovered only by a reload.
 */
describe('uiRealtimeStatus', () => {
	beforeEach(() => {
		connectionState.value = 'connected';
		isConnected.value = true;
		tokenError.value = null;
	});

	it('names the token fault even though the connection is healthy', async () => {
		tokenError.value = new Error('token endpoint down');

		const wrapper = await mountStatus();

		expect(wrapper.text()).toContain('Live Updates Unauthorized');
		// Said in terms of what has stopped working, since a connected-looking page
		// is exactly what makes this fault invisible.
		expect(wrapper.text()).toContain('nothing on this page is updating by itself');
		expect(wrapper.get('[data-icon]').attributes('data-icon')).toBe('i-lucide-shield-alert');
	});

	it('reports a healthy link when there is nothing wrong with it', async () => {
		const wrapper = await mountStatus();

		expect(wrapper.text()).toContain('Live Updates Connected');
		expect(wrapper.get('[data-icon]').attributes('data-icon')).toBe('i-lucide-radio');
	});

	it('calls a page with no Event standing by, not a fault', async () => {
		// With connect deferred until an Event is known (#474), an event-less page
		// sits in `initialized` indefinitely. That is nothing to chase: before the
		// deferral this surfaced as "Disconnected" plus console errors, and an
		// operator on the index page read a healthy client as broken.
		connectionState.value = 'initialized';
		isConnected.value = false;

		const wrapper = await mountStatus();

		expect(wrapper.text()).toContain('Live Updates Standing By');
		expect(wrapper.text()).toContain('connect when an Event is open');
		expect(wrapper.text()).not.toContain('Disconnected');
		expect(wrapper.text()).not.toContain('Reconnecting automatically');
	});

	it('does not call a page load a fault', async () => {
		// Settling states are not disconnections; reporting one would make every
		// reload flash a fault at the operator.
		connectionState.value = 'connecting';
		isConnected.value = false;

		const wrapper = await mountStatus();

		expect(wrapper.text()).toContain('Connecting Live Updates');
		expect(wrapper.text()).not.toContain('Reconnecting automatically');
	});

	it('says a dropped connection heals itself, and that nothing was blanked', async () => {
		connectionState.value = 'suspended';
		isConnected.value = false;

		const wrapper = await mountStatus();

		expect(wrapper.text()).toContain('Live Updates Disconnected');
		expect(wrapper.text()).toContain('Reconnecting automatically');
	});
});
