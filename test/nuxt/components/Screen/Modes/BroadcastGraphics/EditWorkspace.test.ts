import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

enableAutoUnmount(afterEach);

mockNuxtImport('useEventStore', () => () => ({ event: { id: 7, name: 'Regional', game: 'mtg' } }));

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

const StackTreeStub = defineComponent({ template: '<div data-testid="stack-tree" />' });
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
});
