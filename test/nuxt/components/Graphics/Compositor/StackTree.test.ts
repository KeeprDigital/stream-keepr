import type { GraphicsHostContract } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import {
	BROADCAST_GRAPHICS_HOST_CONTRACT,
	FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
	squareShapeGeometry,
} from '~~/shared/modules/graphics';

enableAutoUnmount(afterEach);

const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div><span>{{ label }}</span><slot /></div>',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: { items: { type: Array, required: false }, modelValue: { type: [String, Number], required: false } },
	emits: ['update:modelValue'],
	template: '<select @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, required: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedGraphicId?: string | null;
	selectedTarget?: GraphicsSelectionTarget;
	writable?: boolean;
	contract?: GraphicsHostContract;
	slots?: Record<string, unknown>;
}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/StackTree.vue';
	const { default: StackTree } = await import(componentPath);

	return mount(StackTree, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget ?? { type: 'canvas' },
			selectedGraphicId: options.selectedGraphicId ?? null,
			contract: options.contract ?? BROADCAST_GRAPHICS_HOST_CONTRACT,
			canvasWidth: 1920,
			canvasHeight: 1080,
			writable: options.writable ?? true,
		},
		slots: (options.slots ?? {}) as Parameters<typeof mount>[1] extends { slots?: infer S } ? S : never,
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UButton: UButtonStub,
				UBadge: true,
				UIcon: true,
			},
		},
	});
}

function itemPaletteKinds(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return wrapper.findAll('[data-add-graphic-item-kind]')
		.map(button => button.attributes('data-add-graphic-item-kind'));
}

function emittedGraphics(wrapper: Awaited<ReturnType<typeof mountComponent>>, index = 0) {
	return wrapper.emitted('update:graphics')?.[index]?.[0] as BroadcastGraphicConfig[];
}

function emittedTarget(wrapper: Awaited<ReturnType<typeof mountComponent>>, index = 0) {
	return wrapper.emitted('update:selectedTarget')?.[index]?.[0] as GraphicsSelectionTarget;
}

function groupStack(): BroadcastGraphicConfig {
	return {
		id: 'a',
		name: 'A',
		items: [{
			type: 'group',
			id: 'cluster',
			label: 'Name block',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 400,
			height: 100,
			arrangement: 'row',
			padding: 0,
			gap: 8,
			align: 'stretch',
			justify: 'start',
			clip: false,
			geometry: squareShapeGeometry(),
			children: [{
				type: 'shape',
				id: 'child',
				label: 'Shape 1',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				geometry: squareShapeGeometry(),
				surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
			}],
		}],
	};
}

describe('graphicsCompositorStackTree', () => {
	/**
	 * The graphic-badge slot is host capability, not compositor vocabulary: only a
	 * Broadcast Graphics host has playout state to mark (#373), so the tree offers
	 * the seam per graphic and carries no opinion about what a badge says. A host
	 * that supplies nothing gets exactly the tree it had.
	 */
	it('renders a host-supplied badge beside each Broadcast Graphic in the stack', async () => {
		const wrapper = await mountComponent({
			graphics: [
				{ id: 'lower-third', name: 'Lower Third', items: [] },
				{ id: 'slate', name: 'Slate', items: [] },
			],
			slots: {
				'graphic-badge': ({ graphic }: { graphic: BroadcastGraphicConfig }) =>
					h('span', { 'data-testid': 'host-badge' }, graphic.id),
			},
		});

		const badges = wrapper.findAll('[data-testid="host-badge"]');
		expect(badges.map(badge => badge.text())).toEqual(['lower-third', 'slate']);
		// Inside the graphic's own node, so the badge reads as a fact about that
		// graphic rather than tree furniture.
		expect(wrapper.findAll('[data-testid="broadcast-graphic-node"] [data-testid="host-badge"]')).toHaveLength(2);
	});

	it('adds a Broadcast Graphic to the front of the Screen stack and selects it', async () => {
		const wrapper = await mountComponent({ graphics: [{ id: 'a', name: 'Graphic 1', items: [] }] });

		await wrapper.get('[data-testid="add-broadcast-graphic"]').trigger('click');

		const graphics = emittedGraphics(wrapper);
		expect(graphics.map(graphic => graphic.name)).toEqual(['Graphic 1', 'Graphic 2']);
		expect(emittedTarget(wrapper)).toEqual({ type: 'graphic', graphicId: graphics[1]!.id });
	});

	it('reorders a Broadcast Graphic within the authored back-to-front stack', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'B', items: [] }],
		});

		await wrapper.get('[aria-label="Move A forward"]').trigger('click');

		expect(emittedGraphics(wrapper).map(graphic => graphic.id)).toEqual(['b', 'a']);
	});

	it('cannot move the frontmost Broadcast Graphic any further forward', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'B', items: [] }],
		});

		expect(wrapper.get('[aria-label="Move B forward"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[aria-label="Move A backward"]').attributes('disabled')).toBeDefined();
	});

	it('deletes a Broadcast Graphic and drops the selection', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'B', items: [] }],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'graphic', graphicId: 'a' },
		});

		await wrapper.get('[aria-label="Delete A"]').trigger('click');

		expect(emittedGraphics(wrapper).map(graphic => graphic.id)).toEqual(['b']);
		expect(emittedTarget(wrapper)).toEqual({ type: 'canvas' });
	});

	it('offers only the Graphic Item kinds the Host Contract supports', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		expect(itemPaletteKinds(wrapper)).toEqual(['text', 'shape', 'media', 'social-network-icon', 'group']);
	});

	it('creates a semantic Social Network Icon with the application defaults', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		await wrapper.get('[data-add-graphic-item-kind="social-network-icon"]').trigger('click');

		expect(emittedGraphics(wrapper)[0]?.items[0]).toMatchObject({
			type: 'social-network-icon',
			network: 'twitch',
			color: '#ffffff',
			opacity: 1,
			visible: true,
		});
	});

	it('places a Graphic Item at the front of the Graphic Layer Order and selects it', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		await wrapper.get('[data-add-graphic-item-kind="text"]').trigger('click');
		await nextTick();

		const graphics = emittedGraphics(wrapper);
		expect(graphics[0]?.items.map(item => [item.type, item.label])).toEqual([['text', 'Text 1']]);
		expect(emittedTarget(wrapper)).toEqual({
			type: 'item',
			graphicId: 'a',
			itemId: graphics[0]!.items[0]!.id,
		});
	});

	/**
	 * The split lower-third the #179 fidelity run was building needs four Shapes
	 * in a row. Under a select, the second consecutive Shape was not a change of
	 * value and added nothing at all — silently, with the author left alternating
	 * kinds to work around it (#234).
	 */
	it('adds a second Graphic Item of the kind it just added', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		await wrapper.get('[data-add-graphic-item-kind="shape"]').trigger('click');
		await wrapper.setProps({ graphics: emittedGraphics(wrapper) });
		await wrapper.get('[data-add-graphic-item-kind="shape"]').trigger('click');

		expect(emittedGraphics(wrapper, 1).map(graphic => graphic.items.map(item => item.type)))
			.toEqual([['shape', 'shape']]);
	});

	it('holds no chosen kind of its own for a repeat press to match', async () => {
		// The mechanism, not just the outcome: the defect was a control with a
		// value, so a stubbed re-selection could pass this file while the real
		// USelect kept swallowing the second press.
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		const palette = wrapper.get('[data-testid="graphic-item-palette"]');

		expect(palette.findAll('select')).toHaveLength(0);
		expect(palette.findAllComponents({ name: 'USelect' })).toHaveLength(0);
	});

	it('shows no Graphic Item palette until a Broadcast Graphic is selected', async () => {
		const wrapper = await mountComponent({ graphics: [{ id: 'a', name: 'A', items: [] }] });

		expect(wrapper.find('[data-testid="graphic-item-palette"]').exists()).toBe(false);
	});

	it('deletes a Graphic Item and falls back to its Broadcast Graphic', async () => {
		const wrapper = await mountComponent({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{
					type: 'shape',
					id: 'bar',
					label: 'Shape 1',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					geometry: squareShapeGeometry(),
					surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
				}],
			}],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'bar' },
		});

		await wrapper.get('[aria-label="Delete Shape 1"]').trigger('click');

		expect(emittedGraphics(wrapper)[0]?.items).toEqual([]);
		expect(emittedTarget(wrapper)).toEqual({ type: 'graphic', graphicId: 'a' });
	});

	it('nests the children of a Graphic Group under it as one layer', async () => {
		const wrapper = await mountComponent({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{
					type: 'group',
					id: 'cluster',
					label: 'Name block',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 400,
					height: 100,
					arrangement: 'row',
					padding: 0,
					gap: 8,
					align: 'stretch',
					justify: 'start',
					clip: false,
					geometry: squareShapeGeometry(),
					children: [{
						type: 'shape',
						id: 'child',
						label: 'Shape 1',
						visible: true,
						anchor: 'top-left',
						x: 0,
						y: 0,
						width: 10,
						height: 10,
						geometry: squareShapeGeometry(),
						surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
					}],
				}],
			}],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'cluster' },
		});

		const rows = wrapper.findAll('[data-graphic-item-depth]');
		expect(rows.map(row => row.attributes('data-graphic-item-depth'))).toEqual(['0', '1']);
		expect(rows[1]!.text()).toContain('Shape 1');
	});

	it('offers a Graphic Group child palette that never offers another Graphic Group', async () => {
		const wrapper = await mountComponent({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{
					type: 'group',
					id: 'cluster',
					label: 'Name block',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 400,
					height: 100,
					arrangement: 'row',
					padding: 0,
					gap: 8,
					align: 'stretch',
					justify: 'start',
					clip: false,
					geometry: squareShapeGeometry(),
					children: [],
				}],
			}],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'cluster' },
		});

		expect(wrapper.findAll('[data-add-graphic-group-child-kind]')
			.map(button => button.attributes('data-add-graphic-group-child-kind')))
			.toEqual(['text', 'shape', 'media', 'social-network-icon']);

		await wrapper.get('[data-add-graphic-group-child-kind="text"]').trigger('click');
		await nextTick();

		const graphics = emittedGraphics(wrapper);
		const group = graphics[0]!.items[0]!;
		expect(group.type === 'group' && group.children.map(child => child.label)).toEqual(['Text 1']);
	});

	it('shows no Graphic Group child palette while no group is in the selection', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		expect(wrapper.find('[data-testid="graphic-group-child-palette"]').exists()).toBe(false);
	});

	it('offers no authoring control to a read-only observer', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'B', items: [] }],
			selectedGraphicId: 'a',
			writable: false,
		});

		expect(wrapper.find('[data-testid="add-broadcast-graphic"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-item-palette"]').exists()).toBe(false);
		expect(wrapper.find('[aria-label="Delete A"]').exists()).toBe(false);
		expect(wrapper.find('[aria-label="Move A forward"]').exists()).toBe(false);
	});

	it('still lets a read-only observer select what it is observing', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			writable: false,
		});

		await wrapper.get('[data-testid="broadcast-graphic-node"]').trigger('click');

		expect(emittedTarget(wrapper)).toEqual({ type: 'graphic', graphicId: 'a' });
		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});
	it('offers a read-only observer no control over a Graphic Group child', async () => {
		const wrapper = await mountComponent({
			graphics: [groupStack()],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'cluster' },
			writable: false,
		});

		// The nested row is still there to observe.
		const rows = wrapper.findAll('[data-graphic-item-depth]');
		expect(rows.map(row => row.attributes('data-graphic-item-depth'))).toEqual(['0', '1']);
		expect(rows[1]!.text()).toContain('Shape 1');

		// Its sibling-scoped reorder and delete controls, and the group's own child
		// palette, are not.
		expect(wrapper.find('[data-testid="graphic-group-child-palette"]').exists()).toBe(false);
		expect(wrapper.find('[aria-label="Move Shape 1 forward"]').exists()).toBe(false);
		expect(wrapper.find('[aria-label="Delete Shape 1"]').exists()).toBe(false);
		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});

	it('offers no stack to a host that composes one composition', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'layout', name: 'Feature Match Layout', items: [] }],
			selectedGraphicId: 'layout',
			contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
		});

		expect(wrapper.find('[data-testid="graphic-stack-section"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="add-broadcast-graphic"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="broadcast-graphic-node"]').exists()).toBe(false);
	});

	it('still authors the Graphic Layer Order of a host that composes one composition', async () => {
		// Withholding the stack must not withhold the tree: the whole point of
		// embedding the compositor is to author this composition's items.
		const wrapper = await mountComponent({
			graphics: [{ id: 'layout', name: 'Feature Match Layout', items: [] }],
			selectedGraphicId: 'layout',
			contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
		});

		expect(wrapper.find('[data-testid="graphic-item-palette"]').exists()).toBe(true);
		expect(itemPaletteKinds(wrapper)).not.toContain('social-network-icon');

		await wrapper.get('[data-add-graphic-item-kind="text"]').trigger('click');

		expect(emittedGraphics(wrapper)[0]!.items).toHaveLength(1);
		expect(emittedTarget(wrapper)).toMatchObject({ type: 'item', graphicId: 'layout' });
	});

	it('keeps the stack for a Broadcast Graphics Screen carrying exactly one graphic', async () => {
		// The stack is the host's declaration, not a count. A Screen with one
		// Broadcast Graphic must not silently lose its ability to add a second.
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		expect(wrapper.find('[data-testid="graphic-stack-section"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="add-broadcast-graphic"]').exists()).toBe(true);
	});
});
