import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createInitialBroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import { onAirWith } from '~~/test/helpers/broadcastGraphicsLiveState';
import { shape, surfaceStyle, text } from '~~/test/helpers/graphicsComposition';
import { liveSessionSelectors } from '~~/test/nuxt/helpers/broadcastGraphicsLiveSessionReads';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import EditWorkspace from '~/components/Screen/Modes/BroadcastGraphics/EditWorkspace.vue';

enableAutoUnmount(afterEach);

mockNuxtImport('useEventStore', () => () => ({
	event: { id: 7, name: 'Regional', game: 'mtg' },
}));

// The playout facts the on-air marks and refusals read: the Live Session store over a Live State per test.
const mockLiveState = {
	value: createInitialBroadcastGraphicsLiveState() as BroadcastGraphicsLiveState,
};
mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => liveSessionSelectors(() => mockLiveState.value, () => 1_000));
mockNuxtImport('useBroadcastGraphicsPlayoutClock', () => () => ref(1_000));
const mockToastAdd = vi.fn();
mockNuxtImport('useToast', () => () => ({ add: mockToastAdd }));

// Where the Broadcast Graphic Template library is allowed to appear.

const lowerThird: BroadcastGraphicConfig = { id: 'lower-third', name: 'Lower Third', items: [] };
const slate: BroadcastGraphicConfig = { id: 'slate', name: 'Slate', items: [] };

/** Stands in for the preview, reporting the canvas handles the workspace hands it. */
const PreviewStub = defineComponent({
	props: {
		selectionFrame: { type: Object, default: null },
		selectionLabel: { type: String, default: '' },
		lockedBoxes: {
			type: Array,
			default: () => [],
		},
	},
	emits: [
		'selectTarget',
		'manipulate',
		'rotate',
		'gestureStart',
		'gestureEnd',
	],
	setup(props) {
		return () => h('div', {
			'data-testid': 'preview',
			'data-handles': props.selectionFrame
				? JSON.stringify(props.selectionFrame.rect)
				: 'none',
			'data-label': props.selectionLabel,
			'data-locked': String(props.lockedBoxes.length),
		});
	},
});
/** Stands in for the inspector, reporting the Event facts the workspace hands it. */
const InspectorStub = defineComponent({
	props: {
		eventId: { type: Number, required: true },
		game: { type: String, default: '' },
	},
	emits: ['update:graphics'],
	setup(props, { attrs }) {
		return () => h('div', {
			'data-testid': 'inspector',
			'data-writable': String(attrs.writable),
			'data-event-id': String(props.eventId),
			'data-game': props.game,
		});
	},
});
/** Stands in for the library panel, reporting the props the workspace hands it. */
const TemplateLibraryStub = defineComponent({
	name: 'GraphicsBroadcastGraphicTemplateLibrary',
	props: {
		eventId: { type: Number, required: true },
		screenId: { type: Number, required: true },
		selectedGraphic: { type: Object, default: null },
		writable: { type: Boolean, default: false },
		flushEdits: { type: Function, default: undefined },
	},
	emits: ['placed', 'update:placing'],
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
		graphics: {
			type: Array,
			default: () => [],
		},
		channels: {
			type: Array,
			default: () => [],
		},
		writable: { type: Boolean, default: false },
	},
	setup(props) {
		return () => h('div', {
			'data-testid': 'graphic-channels-panel',
			'data-writable': String(props.writable),
		});
	},
});

async function mountWorkspace(props: Record<string, unknown> = {}) {
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
				...nuxtUiStubs,
				GraphicsCompositorPreview: PreviewStub,
				GraphicsCompositorInspector: InspectorStub,
				GraphicsBroadcastGraphicTemplateLibrary: TemplateLibraryStub,
				ScreenModesBroadcastGraphicsChannels: ChannelsStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('broadcastGraphicsEditWorkspace', () => {
	beforeEach(() => {
		mockLiveState.value = createInitialBroadcastGraphicsLiveState();
	});

	// The sharpest collision guard an author has (#373): a Graphic Input with a live On-air Update
	// Policy applies an Edit-workspace change to program immediately, so the graphic that would…
	it('marks the Broadcast Graphics that are on a program output, and only those', async () => {
		mockLiveState.value = onAirWith({}, { graphicId: 'slate' });
		const wrapper = await mountWorkspace();

		const marked = wrapper.findAll('[data-testid="graphic-on-air"]');
		expect(marked).toHaveLength(1);
		expect(wrapper.get('[data-graphic-id="slate"] [data-testid="graphic-on-air"]').text()).toContain('On air');
		expect(wrapper.find('[data-graphic-id="lower-third"] [data-testid="graphic-on-air"]').exists()).toBe(false);
	});

	// Reconnect Resync's rule, applied to a badge: expose the disconnection rather than act on it.
	it('says playout is unknown on every graphic while the realtime connection is down', async () => {
		mockLiveState.value = onAirWith({}, { graphicId: 'slate' });
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
			[
				{ type: 'graphic', graphicId: 'placed-copy' },
			],
		]);
	});

	// An edit made while a placement is out is built on the stack from before it.
	it('holds authoring while a placement is in flight, leaving the library and the lease notice as they were', async () => {
		const wrapper = await mountWorkspace({ graphics: [] });
		const authoring = () => wrapper.get('[data-testid="graphic-channels-panel"]').attributes('data-writable');
		const library = wrapper.getComponent(TemplateLibraryStub);

		library.vm.$emit('update:placing', true);
		await nextTick();
		expect(authoring()).toBe('false');
		expect(library.attributes('data-writable')).toBe('true');
		expect(wrapper.find('[data-testid="edit-lease-notice"]').exists()).toBe(false);

		library.vm.$emit('update:placing', false);
		await nextTick();
		expect(authoring()).toBe('true');
	});

	it('hands the library the flush of this workspace\'s unsaved edits', async () => {
		const flushEdits = vi.fn(async () => true);
		const wrapper = await mountWorkspace({ flushEdits });

		expect(wrapper.getComponent(TemplateLibraryStub).props('flushEdits')).toBe(flushEdits);
	});

	// The inspector authors Graphic Input Bindings against a curated field catalog that separates
	// common fields from ones specific to this Event's game, so the workspace has to tell it which…
	it('tells the inspector which game this Event is played in', async () => {
		const wrapper = await mountWorkspace();

		expect(wrapper.get('[data-testid="inspector"]').attributes('data-game')).toBe('mtg');
	});

	it('funnels Social Profile Projection authoring through the workspace graphics save path', async () => {
		const wrapper = await mountWorkspace();
		const projected = [
			lowerThird,
			{
				...slate,
				socialProfileProjections: [
					{
						key: 'talent-profile',
						label: 'Talent profile',
						sourceKey: 'talent',
						presentationGroupId: 'profile-group',
						dwellMs: 8_000,
						transition: 'crossfade' as const,
						transitionDurationMs: 250,
					},
				],
			},
		];

		wrapper.getComponent(InspectorStub).vm.$emit('update:graphics', projected);
		await flushPromises();

		expect(wrapper.emitted('update:graphics')).toEqual([
			[projected],
		]);
		// There is no projection-specific write that could bypass the mode document's
		// Graphics Authoring Lease and strict save path.
		expect(wrapper.emitted('update:socialProfileProjections')).toBeUndefined();
	});

	// Wiring: the shared save-state display is told this workspace's save and
	// lease, and its Retry reaches the host. Its rules live with the display.
	describe('save state', () => {
		it('reports a failed save in the authority\'s own words, with a retry', async () => {
			const wrapper = await mountWorkspace({
				saveState: 'failed',
				saveError: 'Graphic Asset Reference at graphics.lower-third.items.logo.asset is not selectable',
			});

			const state = wrapper.get('[data-testid="graphics-save-state"]');
			expect(state.attributes('data-save-state')).toBe('failed');
			expect(state.text()).toContain('Graphic Asset Reference at graphics.lower-third.items.logo.asset is not selectable');

			await wrapper.get('[data-testid="graphics-save-retry"]').trigger('click');
			expect(wrapper.emitted('retrySave')).toHaveLength(1);
		});

		it('shows no save state to an observing session', async () => {
			const wrapper = await mountWorkspace({ writable: false, saveState: 'failed', saveError: 'refused' });

			expect(wrapper.find('[data-testid="graphics-save-state"]').exists()).toBe(false);
		});
	});

	// Who is holding the lease, as a person (#398, ADR-0010).
	describe('the notice an observing session is shown', () => {
		it('names the person holding the lease when the server resolved one', async () => {
			const wrapper = await mountWorkspace({ writable: false, holderName: 'Marcus Angel' });

			const notice = wrapper.get('[data-testid="edit-lease-notice"]').text();
			expect(notice).toContain('Marcus Angel holds the Graphics Authoring Lease');
			expect(notice).toContain('in another browser');
		});

		it('still says the artifact is held when the holder resolves to nobody', async () => {
			// A session that has since ended, or a user deleted after taking it: the
			// artifact is still held, so the notice states that rather than falling
			// silent or inventing a name.
			const wrapper = await mountWorkspace({ writable: false, holderName: null });

			expect(wrapper.get('[data-testid="edit-lease-notice"]').text())
				.toContain('Another session holds the Graphics Authoring Lease');
		});

		it('offers the takeover beside the name rather than instead of it', async () => {
			const wrapper = await mountWorkspace({ writable: false, holderName: 'Marcus Angel', canTakeOver: true });

			expect(wrapper.get('[data-testid="edit-lease-notice"]').text()).toContain('Marcus Angel');
			expect(wrapper.find('[data-testid="edit-lease-take-over"]').exists()).toBe(true);
		});
	});

	/** The clipboard module owns the paste rules; the workspace wires keys to them under the lease. */
	describe('copy and paste', () => {
		const panel = surfaceStyle({
			fill: { type: 'solid', color: '#ff0000' },
		});
		const name = text('name', { surfaceStyle: panel });
		const bed = shape('bed');
		const graphics: BroadcastGraphicConfig[] = [
			{
				id: 'lower-third',
				name: 'Lower Third',
				items: [bed, name],
			},
			{ id: 'slate', name: 'Slate', items: [] },
		];

		async function press(code: string, init: KeyboardEventInit = {}) {
			window.dispatchEvent(new KeyboardEvent('keydown', {
				code,
				metaKey: true,
				bubbles: true,
				cancelable: true,
				...init,
			}));
			await flushPromises();
		}

		beforeEach(() => {
			localStorage.clear();
			mockToastAdd.mockClear();
		});

		it('copies the selected Graphic Item and pastes it into the selected Broadcast Graphic, selecting the copy', async () => {
			const wrapper = await mountWorkspace({
				graphics,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});
			await press('KeyC');
			await wrapper.setProps({
				selectedTarget: { type: 'graphic', graphicId: 'slate' },
			});

			await press('KeyV');

			const [next] = wrapper.emitted('update:graphics')!.at(-1) as [BroadcastGraphicConfig[]];
			const pasted = next.find(graphic => graphic.id === 'slate')!.items;
			expect(pasted).toMatchObject([
				{ type: 'text', label: 'name', x: name.x + 20 },
			]);
			expect(wrapper.emitted('update:selectedTarget')!.at(-1)).toEqual([
				{ type: 'item', graphicId: 'slate', itemId: pasted[0]!.id },
			]);
		});

		it('pastes a copied style onto the selected Graphic Item with ⌘⌥V', async () => {
			const wrapper = await mountWorkspace({
				graphics,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});
			await press('KeyC', { altKey: true });
			await wrapper.setProps({
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bed' },
			});

			await press('KeyV', { altKey: true });

			const [next] = wrapper.emitted('update:graphics')!.at(-1) as [BroadcastGraphicConfig[]];
			expect(next[0]!.items[0]).toMatchObject({ id: 'bed', surfaceStyle: panel });
		});

		it('copies for an observing session, which cannot paste', async () => {
			const wrapper = await mountWorkspace({
				graphics,
				writable: false,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			await press('KeyC');
			await press('KeyV');
			await nextTick();

			expect(mockToastAdd).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Copied 1 layer' }));
			expect(wrapper.emitted('update:graphics')).toBeUndefined();
		});
	});

	/** Wiring: the shared editor's rules live with it; the workspace hands it the stack, the lease and what is on air. */
	describe('the shared graphics editor', () => {
		const name = text('name');
		const graphics: BroadcastGraphicConfig[] = [
			{
				id: 'lower-third',
				name: 'Lower Third',
				items: [
					name,
					shape('bed'),
				],
			},
			{ id: 'slate', name: 'Slate', items: [] },
		];
		const renamed = graphics.map(graphic => graphic.id === 'lower-third'
			? { ...graphic, name: 'Talent' }
			: graphic);

		// An edit to a graphic on a program output would reach program at once.
		it.each([
			{
				playout: 'off air',
				live: () => createInitialBroadcastGraphicsLiveState(),
				writable: 'true',
				written: [
					[renamed],
				],
			},
			{
				playout: 'on air',
				live: () => onAirWith({}, { graphicId: 'lower-third' }),
				writable: 'false',
				written: undefined,
			},
		])('lets the inspector edit a Broadcast Graphic $playout: writable=$writable', async ({ live, writable, written }) => {
			mockLiveState.value = live();
			const wrapper = await mountWorkspace({
				graphics,
				selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
				selectedGraphicId: 'lower-third',
			});

			expect(wrapper.get('[data-testid="inspector"]').attributes('data-writable')).toBe(writable);
			expect(wrapper.find('[data-testid="edit-on-air-notice"]').exists()).toBe(writable === 'false');
			wrapper.getComponent(InspectorStub).vm.$emit('update:graphics', renamed);
			await flushPromises();
			expect(wrapper.emitted('update:graphics')).toEqual(written);
		});

		it('undoes an inspector edit with ⌘Z', async () => {
			const wrapper = await mountWorkspace({
				graphics,
				selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
				selectedGraphicId: 'lower-third',
			});
			wrapper.getComponent(InspectorStub).vm.$emit('update:graphics', renamed);
			await wrapper.setProps({ graphics: renamed });

			window.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'z',
				metaKey: true,
				bubbles: true,
				cancelable: true,
			}));
			await flushPromises();

			expect(wrapper.emitted('update:graphics')!.at(-1)).toEqual([graphics]);
		});

		it('shows the panel for several layers once two are selected, and tells the page their Broadcast Graphic', async () => {
			const wrapper = await mountWorkspace({
				graphics,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				selectedGraphicId: 'lower-third',
			});

			await wrapper.get('[data-layer-key="item:lower-third:bed"] [data-testid="layer-select"]').trigger('click', { metaKey: true });

			expect(wrapper.get('[data-testid="multi-layer-count"]').text()).toBe('2 layers');
			expect(wrapper.find('[data-testid="inspector"]').exists()).toBe(false);
			expect(wrapper.emitted('update:selectedTarget')!.at(-1)).toEqual([
				{ type: 'graphic', graphicId: 'lower-third' },
			]);
		});
	});

	// Canvas handles: the preview moves what the editor has selected, as the editor may.
	describe('the preview\'s canvas handles', () => {
		const bed = shape('bed');
		const graphics: BroadcastGraphicConfig[] = [
			{
				id: 'lower-third',
				name: 'Lower Third',
				items: [
					text('name'),
					bed,
					shape('frame', { locked: true }),
				],
			},
		];
		const onBed = {
			graphics,
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bed' },
			selectedGraphicId: 'lower-third',
		};
		const preview = (wrapper: Awaited<ReturnType<typeof mountWorkspace>>) => wrapper.get('[data-testid="preview"]');

		it.each([
			{
				when: 'it may author',
				props: {},
				live: () => createInitialBroadcastGraphicsLiveState(),
				handles: JSON.stringify({
					x: 10,
					y: 20,
					width: 300,
					height: 100,
				}),
			},
			{
				when: 'it observes',
				props: { writable: false },
				live: () => createInitialBroadcastGraphicsLiveState(),
				handles: 'none',
			},
			{
				when: 'the graphic is on air',
				props: {},
				live: () => onAirWith({}, { graphicId: 'lower-third' }),
				handles: 'none',
			},
			{
				when: 'playout is unknown',
				props: { playoutDisconnected: true },
				live: () => createInitialBroadcastGraphicsLiveState(),
				handles: 'none',
			},
		])('handles the selected item when $when: $handles', async ({ props, live, handles }) => {
			mockLiveState.value = live();
			const wrapper = await mountWorkspace({
				...onBed,
				...props,
			});

			expect(preview(wrapper).attributes('data-handles')).toBe(handles);
			expect(preview(wrapper).attributes('data-label')).toBe('bed');
		});

		it('writes a canvas drag to the selected item, undone as one step', async () => {
			const wrapper = await mountWorkspace(onBed);
			const stub = wrapper.getComponent(PreviewStub);

			stub.vm.$emit('gestureStart');
			stub.vm.$emit('manipulate', {
				x: 40,
				y: 20,
				width: 300,
				height: 100,
			}, 1);
			await wrapper.setProps({ graphics: wrapper.emitted<[BroadcastGraphicConfig[]]>('update:graphics')!.at(-1)![0] });
			stub.vm.$emit('manipulate', {
				x: 90,
				y: 60,
				width: 300,
				height: 100,
			}, 1);
			stub.vm.$emit('gestureEnd');
			await flushPromises();
			const moved = wrapper.emitted<[BroadcastGraphicConfig[]]>('update:graphics')!.at(-1)![0];
			expect(moved[0]!.items.find(item => item.id === 'bed')).toMatchObject({ x: 90, y: 60 });

			await wrapper.setProps({ graphics: moved });
			await wrapper.get('[data-testid="editor-undo"]').trigger('click');
			expect(wrapper.emitted('update:graphics')!.at(-1)).toEqual([graphics]);
		});

		it('adds an item to the selection with a ⌘-click in the preview, and handles both together', async () => {
			const wrapper = await mountWorkspace(onBed);

			wrapper.getComponent(PreviewStub).vm.$emit('selectTarget', { type: 'item', graphicId: 'lower-third', itemId: 'name' }, true);
			await nextTick();

			expect(wrapper.get('[data-testid="multi-layer-count"]').text()).toBe('2 layers');
			expect(preview(wrapper).attributes('data-label')).toBe('2 layers');
			expect(preview(wrapper).attributes('data-handles')).toBe(JSON.stringify({ x: 0, y: 0, width: 400, height: 120 }));
		});

		it('badges a selected locked item rather than handling it', async () => {
			const wrapper = await mountWorkspace({
				...onBed,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'frame' },
			});

			expect(preview(wrapper).attributes('data-handles')).toBe('none');
			expect(preview(wrapper).attributes('data-locked')).toBe('1');
		});
	});
});
