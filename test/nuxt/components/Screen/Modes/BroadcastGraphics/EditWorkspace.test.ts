import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';

enableAutoUnmount(afterEach);

mockNuxtImport('useEventStore', () => () => ({ event: { id: 7, name: 'Regional', game: 'mtg' } }));

/**
 * The playout facts the on-air badge reads (#373): the Live Session store's
 * on-air set, per test. The store itself is the Program monitor's authority and
 * has its own suite; here it only has to answer for the badge.
 */
const onAirIds = { value: [] as string[] };
mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	onAirGraphicIds: () => onAirIds.value,
}));
mockNuxtImport('useBroadcastGraphicsPlayoutClock', () => () => ref(1_000));

/**
 * Where the Broadcast Graphic Template library is allowed to appear.
 *
 * The Edit workspace is an authoring surface and carries the library; the Live
 * workspace and Live Control are operating surfaces and must carry no template
 * action at all. That split is asserted from both sides — here, and in the Live
 * workspace's own suite — because a template action reachable from Live Control
 * would put a structural change to the Screen one click from a live programme.
 */

const lowerThird: BroadcastGraphicConfig = { id: 'lower-third', name: 'Lower Third', items: [] };
const slate: BroadcastGraphicConfig = { id: 'slate', name: 'Slate', items: [] };

/**
 * Renders the host's graphic-badge slot for each graphic it is given, the way
 * the real tree does, so the badge logic is observable through the stub.
 */
const StackTreeStub = defineComponent({
	props: { graphics: { type: Array, default: () => [] } },
	setup(props, { slots }) {
		return () => h('div', { 'data-testid': 'stack-tree' }, (props.graphics as Array<{ id: string }>).map(graphic =>
			h('div', { 'data-testid': 'stack-tree-row', 'data-graphic-id': graphic.id }, slots['graphic-badge']?.({ graphic }))));
	},
});
const PreviewStub = defineComponent({ template: '<div data-testid="preview" />' });
/** Stands in for the inspector, reporting the Event facts the workspace hands it. */
const InspectorStub = defineComponent({
	props: { eventId: { type: Number, required: true }, game: { type: String, default: '' } },
	setup(props) {
		return () => h('div', {
			'data-testid': 'inspector',
			'data-event-id': String(props.eventId),
			'data-game': props.game,
		});
	},
});
const UIconStub = defineComponent({ template: '<i />' });
const UButtonStub = defineComponent({
	props: { disabled: { type: Boolean, default: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

/** Stands in for the library panel, reporting the props the workspace hands it. */
const TemplateLibraryStub = defineComponent({
	name: 'GraphicsBroadcastGraphicTemplateLibrary',
	props: {
		eventId: { type: Number, required: true },
		screenId: { type: Number, required: true },
		selectedGraphic: { type: Object, default: null },
		writable: { type: Boolean, default: false },
	},
	emits: ['placed'],
	setup(props, { emit }) {
		return () => h('div', {
			'data-testid': 'template-library',
			'data-event-id': String(props.eventId),
			'data-screen-id': String(props.screenId),
			'data-selected-graphic': props.selectedGraphic?.id ?? '',
			'data-writable': String(props.writable),
			'onClick': () => emit('placed', 'placed-copy'),
		});
	},
});

/** Stands in for the Graphic Channels panel, reporting what the workspace hands it. */
const ChannelsStub = defineComponent({
	name: 'ScreenModesBroadcastGraphicsChannels',
	props: {
		graphics: { type: Array, default: () => [] },
		channels: { type: Array, default: () => [] },
		writable: { type: Boolean, default: false },
	},
	setup(props) {
		return () => h('div', {
			'data-testid': 'graphic-channels-panel',
			'data-channels': String(props.channels.length),
			'data-writable': String(props.writable),
		});
	},
});

async function mountWorkspace(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/EditWorkspace.vue';
	const { default: EditWorkspace } = await import(componentPath);

	const wrapper = mount(EditWorkspace, {
		props: {
			eventId: 7,
			screen: { id: 3, slug: 'main' } as Screen,
			graphics: [lowerThird, slate],
			channels: [],
			selectedTarget: { type: 'graphic', graphicId: 'slate' },
			selectedGraphicId: 'slate',
			canvasWidth: 1920,
			canvasHeight: 1080,
			writable: true,
			leaseStatus: 'ready',
			...props,
		},
		global: {
			stubs: {
				GraphicsCompositorStackTree: StackTreeStub,
				GraphicsCompositorPreview: PreviewStub,
				GraphicsCompositorInspector: InspectorStub,
				GraphicsBroadcastGraphicTemplateLibrary: TemplateLibraryStub,
				ScreenModesBroadcastGraphicsChannels: ChannelsStub,
				UIcon: UIconStub,
				UButton: UButtonStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('broadcastGraphicsEditWorkspace', () => {
	beforeEach(() => {
		onAirIds.value = [];
	});

	/**
	 * The sharpest collision guard an author has (#373): a Graphic Input with a
	 * live On-air Update Policy applies an Edit-workspace change to program
	 * immediately, so the graphic that would carry it is marked in the authoring
	 * tree itself. The mark is binary and covers every state that composes into
	 * the frame — entering, on-air, updating, exiting — because the author's
	 * question is "can my edit touch program?", which is yes in all four.
	 */
	it('marks the Broadcast Graphics that are on a program output, and only those', async () => {
		onAirIds.value = ['slate'];
		const wrapper = await mountWorkspace();

		const marked = wrapper.findAll('[data-testid="graphic-on-air"]');
		expect(marked).toHaveLength(1);
		expect(wrapper.get('[data-graphic-id="slate"] [data-testid="graphic-on-air"]').text()).toContain('On air');
		expect(wrapper.find('[data-graphic-id="lower-third"] [data-testid="graphic-on-air"]').exists()).toBe(false);
	});

	/**
	 * Reconnect Resync's rule, applied to a badge: expose the disconnection
	 * rather than act on it. While the realtime connection is down this client
	 * cannot know what is on air, and a frozen or absent mark would read as
	 * "not on air" on exactly the surface guarding live edits.
	 */
	it('says playout is unknown on every graphic while the realtime connection is down', async () => {
		onAirIds.value = ['slate'];
		const wrapper = await mountWorkspace({ playoutDisconnected: true });

		expect(wrapper.findAll('[data-testid="graphic-playout-unknown"]')).toHaveLength(2);
		expect(wrapper.findAll('[data-testid="graphic-on-air"]')).toHaveLength(0);
	});

	it('marks nothing while nothing is on air and the connection holds', async () => {
		const wrapper = await mountWorkspace();

		expect(wrapper.findAll('[data-testid="graphic-on-air"]')).toHaveLength(0);
		expect(wrapper.findAll('[data-testid="graphic-playout-unknown"]')).toHaveLength(0);
	});

	it('carries the Broadcast Graphic Template library for this Screen', async () => {
		const wrapper = await mountWorkspace();

		const library = wrapper.get('[data-testid="template-library"]');
		expect(library.attributes('data-event-id')).toBe('7');
		expect(library.attributes('data-screen-id')).toBe('3');
		// The selected Broadcast Graphic is the one an author saves as a template.
		expect(library.attributes('data-selected-graphic')).toBe('slate');
		expect(library.attributes('data-writable')).toBe('true');
	});

	it('selects the Broadcast Graphic a placement created', async () => {
		const wrapper = await mountWorkspace();

		await wrapper.get('[data-testid="template-library"]').trigger('click');

		expect(wrapper.emitted('update:selectedTarget')).toEqual([
			[{ type: 'graphic', graphicId: 'placed-copy' }],
		]);
	});

	it('leaves an observing session browsing the library read-only', async () => {
		const wrapper = await mountWorkspace({ writable: false });

		expect(wrapper.get('[data-testid="template-library"]').attributes('data-writable')).toBe('false');
	});

	it('carries Graphic Channel authoring, under the same Graphics Authoring Lease', async () => {
		const wrapper = await mountWorkspace({
			channels: [{ id: 'thirds', name: 'Lower thirds' }],
			writable: false,
		});

		const panel = wrapper.get('[data-testid="graphic-channels-panel"]');
		expect(panel.attributes('data-channels')).toBe('1');
		expect(panel.attributes('data-writable')).toBe('false');
	});

	/**
	 * The inspector authors Graphic Input Bindings against a curated field catalog
	 * that separates common fields from ones specific to this Event's game, so the
	 * workspace has to tell it which game — otherwise an author would be offered a
	 * field this Event can never resolve.
	 */
	it('tells the inspector which game this Event is played in', async () => {
		const wrapper = await mountWorkspace();

		expect(wrapper.get('[data-testid="inspector"]').attributes('data-game')).toBe('mtg');
	});

	/**
	 * The save's answer, on the surface where the question is asked (#381). A
	 * first authored save of an ordinary show measured ~8.3 s against deployed
	 * remote D1 (#374), and an author tempted to navigate away mid-save had
	 * nothing here saying whether the write landed.
	 */
	describe('save state', () => {
		it('says a save is in flight', async () => {
			const wrapper = await mountWorkspace({ saveState: 'saving' });

			const state = wrapper.get('[data-testid="edit-save-state"]');
			expect(state.attributes('data-save-state')).toBe('saving');
			expect(state.text()).toContain('Saving');
		});

		// Committed is an affirmative fact, not the absence of "Saving…" — the
		// distinction an author who looked away cannot otherwise make.
		it('confirms a committed save', async () => {
			const wrapper = await mountWorkspace({ saveState: 'committed' });

			const state = wrapper.get('[data-testid="edit-save-state"]');
			expect(state.attributes('data-save-state')).toBe('committed');
			expect(state.text()).toMatch(/saved/i);
		});

		it('reports a failed save in the authority\'s own words, with a retry', async () => {
			const wrapper = await mountWorkspace({
				saveState: 'failed',
				saveError: 'Graphic Asset Reference at graphics.lower-third.items.logo.asset is not selectable',
			});

			const state = wrapper.get('[data-testid="edit-save-state"]');
			expect(state.attributes('data-save-state')).toBe('failed');
			expect(state.text()).toContain('Graphic Asset Reference at graphics.lower-third.items.logo.asset is not selectable');

			await wrapper.get('[data-testid="edit-save-retry"]').trigger('click');
			expect(wrapper.emitted('retrySave')).toHaveLength(1);
		});

		it('shows nothing before the first edit', async () => {
			const wrapper = await mountWorkspace({ saveState: 'idle' });

			expect(wrapper.find('[data-testid="edit-save-state"]').exists()).toBe(false);
		});

		// An observer's workspace projects a colleague's accepted changes; it has
		// no write in flight and must not claim one.
		it('shows no save state to an observing session', async () => {
			const wrapper = await mountWorkspace({ writable: false, saveState: 'failed', saveError: 'refused' });

			expect(wrapper.find('[data-testid="edit-save-state"]').exists()).toBe(false);
		});
	});

	/**
	 * Who is holding the lease, as a person (#398, ADR-0010).
	 *
	 * A lease is held by a session, and "another session" — all this surface could
	 * say while the holder was an anonymous cookie — is true and useless: what an
	 * operator does next depends on whether that is a colleague to go and ask or
	 * their own second window to close. The server resolves session → user, so the
	 * editor is handed a name and never another browser's session id.
	 */
	describe('the notice an observing session is shown', () => {
		it('names the person holding the lease when the server resolved one', async () => {
			const wrapper = await mountWorkspace({ writable: false, heldBy: 'Marcus Angel' });

			const notice = wrapper.get('[data-testid="edit-lease-notice"]').text();
			expect(notice).toContain('Marcus Angel holds the Graphics Authoring Lease');
			expect(notice).toContain('in another browser');
		});

		it('still says the artifact is held when the holder resolves to nobody', async () => {
			// A session that has since ended, or a user deleted after taking it: the
			// artifact is still held, so the notice states that rather than falling
			// silent or inventing a name.
			const wrapper = await mountWorkspace({ writable: false, heldBy: null });

			expect(wrapper.get('[data-testid="edit-lease-notice"]').text())
				.toContain('Another session holds the Graphics Authoring Lease');
		});

		it('offers the takeover beside the name rather than instead of it', async () => {
			const wrapper = await mountWorkspace({ writable: false, heldBy: 'Marcus Angel', canTakeOver: true });

			expect(wrapper.get('[data-testid="edit-lease-notice"]').text()).toContain('Marcus Angel');
			expect(wrapper.find('[data-testid="edit-lease-take-over"]').exists()).toBe(true);
		});
	});
});
