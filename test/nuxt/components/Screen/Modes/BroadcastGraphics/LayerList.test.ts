import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { BROADCAST_GRAPHICS_HOST_CONTRACT, graphicItemDefinitionsForHost } from '~~/shared/modules/graphics';
import { group, text } from '~~/test/helpers/graphicsComposition';
import { broadcastGraphicsEditing, EDITED_GRAPHIC_ID, OTHER_GRAPHIC_ID } from '~~/test/nuxt/helpers/graphicsEditorHosts';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import LayerList from '~/components/Screen/Modes/BroadcastGraphics/LayerList.vue';

/**
 * The Broadcast Graphics layer list: the shared one, each Broadcast Graphic a
 * top-level row with its Graphic Items nested, front at the top. The verbs'
 * rules live with the shared editor; this is what the list offers and selects.
 */

function mountList({ writable = true, onAir = [] as string[] } = {}) {
	const harness = broadcastGraphicsEditing({
		writable,
		items: [
			text('a'),
			group('g', [
				text('g1'),
			]),
		],
	});
	harness.onAir.value = new Set(onAir);
	const wrapper = mount(LayerList, {
		props: {
			graphics: harness.graphics.value,
			editor: harness.editor,
			tree: harness.tree,
			selectedGraphicId: EDITED_GRAPHIC_ID,
			canvasWidth: 1920,
			canvasHeight: 1080,
		},
		global: { stubs: nuxtUiStubs },
	});
	const sync = async () => {
		await wrapper.setProps({ graphics: harness.graphics.value });
	};
	return { wrapper, harness, sync };
}

type Wrapper = ReturnType<typeof mountList>['wrapper'];

function graphicRows(wrapper: Wrapper) {
	return wrapper.findAll('[data-testid="broadcast-graphic-row"]').map(row => row.attributes('data-graphic-id'));
}

function layerRows(wrapper: Wrapper) {
	return wrapper.findAll('[data-testid="layer-row"]').map(row => [
		row.attributes('data-layer-key'),
		row.attributes('data-layer-depth'),
	]);
}

/** The labels of an open menu's entries. */
function menuEntries(wrapper: Wrapper) {
	return wrapper.findAll('[role="menuitem"]').map(entry => entry.text());
}

async function openAddMenu(wrapper: Wrapper) {
	await wrapper.get('[data-testid="layer-add"]').trigger('click');
}

describe('broadcastGraphicsLayerList', () => {
	it('lists each Broadcast Graphic front to back, its Graphic Items nested beneath it', () => {
		const { wrapper } = mountList();

		expect(graphicRows(wrapper)).toEqual([EDITED_GRAPHIC_ID, OTHER_GRAPHIC_ID]);
		expect(layerRows(wrapper)).toEqual([
			['item:lower-third:g', '0'],
			['item:lower-third:g1', '1'],
			['item:lower-third:a', '0'],
			['item:slate:s', '0'],
		]);
	});

	it('offers the Graphic Item kinds the Broadcast Graphics Host Contract declares, and a Broadcast Graphic', async () => {
		const { wrapper } = mountList();

		await openAddMenu(wrapper);

		expect(menuEntries(wrapper)).toEqual([
			...graphicItemDefinitionsForHost(BROADCAST_GRAPHICS_HOST_CONTRACT).map(definition => definition.label),
			'Broadcast Graphic',
		]);
	});

	it('selects a Broadcast Graphic it adds, once the edit is admitted', async () => {
		const { wrapper, harness } = mountList();

		await openAddMenu(wrapper);
		await wrapper.findAll('[role="menuitem"]').find(entry => entry.text() === 'Broadcast Graphic')!.trigger('click');

		const added = harness.graphics.value.at(-1)!;
		expect(harness.graphics.value).toHaveLength(3);
		expect(wrapper.emitted('selectGraphic')).toEqual([
			[added.id],
		]);
	});

	it('selects a Broadcast Graphic from its row, letting go of every layer', async () => {
		const { wrapper, harness } = mountList();
		harness.editor.select(harness.layer('a'));

		await wrapper.get(`[data-graphic-id="${OTHER_GRAPHIC_ID}"] [data-testid="broadcast-graphic-select"]`).trigger('click');

		expect(harness.editor.layers.value).toEqual([]);
		expect(wrapper.emitted('selectGraphic')).toEqual([
			[OTHER_GRAPHIC_ID],
		]);
	});

	it('moves a Broadcast Graphic within the stack from its row\'s menu, as one undo step', async () => {
		const { wrapper, harness, sync } = mountList();

		await wrapper.get(`[data-graphic-id="${OTHER_GRAPHIC_ID}"] [data-testid="broadcast-graphic-more"]`).trigger('click');
		await wrapper.findAll('[role="menuitem"]').find(entry => entry.text() === 'Bring to front')!.trigger('click');
		await sync();

		expect(graphicRows(wrapper)).toEqual([OTHER_GRAPHIC_ID, EDITED_GRAPHIC_ID]);
		harness.editor.undo();
		await sync();
		expect(graphicRows(wrapper)).toEqual([EDITED_GRAPHIC_ID, OTHER_GRAPHIC_ID]);
	});

	// A projection reads its Presentation Group: the inspector removes the two together.
	it('offers no Delete of a Social Profile Projection\'s Presentation Group alone, saying why', async () => {
		const { wrapper, harness, sync } = mountList();
		harness.graphics.value = harness.graphics.value.map((graphic): BroadcastGraphicConfig => graphic.id === EDITED_GRAPHIC_ID
			? {
					...graphic,
					socialProfileProjections: [
						{
							key: 'profile',
							label: 'Profile',
							sourceKey: 'talent',
							presentationGroupId: 'g',
							dwellMs: 8_000,
							transition: 'crossfade',
							transitionDurationMs: 250,
						},
					],
				}
			: graphic);
		await sync();
		harness.editor.select(harness.layer('g'));
		await flushPromises();

		await wrapper.get('[data-layer-key="item:lower-third:g"] [data-testid="layer-more"]').trigger('click');
		const remove = wrapper.findAll('[role="menuitem"]').find(entry => entry.text() === 'Delete')!;

		expect(remove.attributes('disabled')).toBeDefined();
		expect(remove.attributes('aria-description')).toContain('delete the projection and Presentation Group together');
	});

	it.each([
		{
			who: 'a session observing another\'s lease',
			writable: false,
			onAir: [],
			graphicMenus: 0,
		},
		{
			who: 'the lease holder, for a Broadcast Graphic on air',
			writable: true,
			onAir: [EDITED_GRAPHIC_ID],
			graphicMenus: 2,
		},
	])('offers $who no edit to its layers', async ({ writable, onAir, graphicMenus }) => {
		const { wrapper } = mountList({ writable, onAir });

		const edited = wrapper.findAll('[data-testid="layer-row"]').filter(row => row.attributes('data-layer-key')!.startsWith(`item:${EDITED_GRAPHIC_ID}:`));
		for (const row of edited) {
			expect(row.find('[data-testid="layer-more"]').exists()).toBe(false);
			expect(row.get('[data-testid="layer-visibility"]').attributes('disabled')).toBeDefined();
		}
		expect(wrapper.findAll('[data-testid="broadcast-graphic-more"]')).toHaveLength(graphicMenus);
	});

	// Graphics on air composite in stack order: a move between two of them reaches program.
	it.each([
		{
			onAir: [EDITED_GRAPHIC_ID, OTHER_GRAPHIC_ID],
			offered: false,
		},
		{
			onAir: [EDITED_GRAPHIC_ID],
			offered: true,
		},
	])('offers a move past the other Broadcast Graphic with $onAir on air: $offered', async ({ onAir, offered }) => {
		const { wrapper } = mountList({ onAir });

		await wrapper.get(`[data-graphic-id="${EDITED_GRAPHIC_ID}"] [data-testid="broadcast-graphic-more"]`).trigger('click');
		const back = wrapper.findAll('[role="menuitem"]').find(entry => entry.text().startsWith('Send to back'))!;

		expect(back.attributes('disabled') === undefined).toBe(offered);
	});

	it('offers no Delete of a Broadcast Graphic on air', async () => {
		const { wrapper } = mountList({
			onAir: [EDITED_GRAPHIC_ID],
		});

		await wrapper.get(`[data-graphic-id="${EDITED_GRAPHIC_ID}"] [data-testid="broadcast-graphic-more"]`).trigger('click');
		const remove = wrapper.findAll('[role="menuitem"]').find(entry => entry.text() === 'Delete')!;

		expect(remove.attributes('disabled')).toBeDefined();
	});
});
