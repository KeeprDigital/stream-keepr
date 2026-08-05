import type { GraphicsHostContract } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GraphicGroupItemConfig,
	GraphicInputDeclaration,
	GraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { FEATURE_MATCH_TOKEN_CATALOGUE } from '~~/shared/featureMatchTokenCatalogue';
import {
	BROADCAST_GRAPHICS_HOST_CONTRACT,
	DEFAULT_GRAPHIC_TYPOGRAPHY,
	FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
	getGraphicItemDefinition,
	squareShapeGeometry,
} from '~~/shared/modules/graphics';
import { MAX_GRAPHIC_TEXT_LENGTH } from '~~/shared/types/graphics';

enableAutoUnmount(afterEach);

const shapeItem: GraphicItemConfig = {
	type: 'shape',
	id: 'bar',
	label: 'Shape 1',
	visible: true,
	anchor: 'center',
	x: 100,
	y: 200,
	width: 400,
	height: 100,
	geometry: squareShapeGeometry(),
	surfaceStyle: { fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 1 },
};

const groupItem: GraphicGroupItemConfig = {
	type: 'group',
	id: 'cluster',
	label: 'Name block',
	visible: true,
	anchor: 'top-left',
	x: 200,
	y: 400,
	width: 800,
	height: 200,
	arrangement: 'row',
	padding: 0,
	gap: 16,
	align: 'stretch',
	justify: 'start',
	clip: false,
	geometry: squareShapeGeometry(),
	children: [],
};

function groupWith(
	children: GraphicGroupItemConfig['children'],
	overrides: Partial<GraphicGroupItemConfig> = {},
): GraphicGroupItemConfig {
	return { ...groupItem, children, ...overrides };
}

const textItem: GraphicItemConfig = {
	type: 'text',
	id: 'name',
	label: 'Text 1',
	visible: true,
	anchor: 'top-left',
	x: 0,
	y: 0,
	width: 400,
	height: 80,
	text: 'Commentator',
	typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
	overflowPolicy: 'ellipsis',
	minFontSize: 24,
};

const mediaItem: GraphicItemConfig = {
	type: 'media',
	id: 'logo',
	label: 'Sponsor',
	visible: true,
	anchor: 'top-left',
	x: 40,
	y: 60,
	width: 480,
	height: 270,
	asset: { assetId: 'asset-1' as never, revisionId: 'revision-1' as never },
	mediaKind: 'image',
	fit: 'cover',
	focalPosition: { horizontal: 0.5, vertical: 0.5 },
	opacity: 1,
	playbackRate: 1,
	loop: true,
};

function stack(items: GraphicItemConfig[]): BroadcastGraphicConfig[] {
	return [{ id: 'lower-third', name: 'Lower Third', items }];
}

/**
 * Stands in for `UFormField`. The label is reflected onto the element as well as
 * rendered, so a test can ask which control a label belongs to rather than searching
 * the panel's text for it — "Font" is a substring of both "Font source" and "Font
 * size", and a control is only correctly labelled if the label is on that control.
 */
const SlotOnlyStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div :data-label="label"><span>{{ label }}</span><slot /></div>',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: { modelValue: { type: [String, Number], required: false }, items: { type: Array, required: false } },
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" />',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: { modelValue: { type: Number, required: false } },
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const UInputStub = defineComponent({
	name: 'UInput',
	props: { modelValue: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" />',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, required: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

const GraphicsAssetFocusPickerStub = defineComponent({
	name: 'GraphicsAssetFocusPicker',
	props: {
		modelValue: { type: Object, required: false },
		eventId: { type: Number, required: false },
		fieldLabel: { type: String, required: false },
		assetKind: { type: [String, Array], required: false },
		videoTarget: { type: String, required: false },
	},
	emits: ['update:modelValue', 'select'],
	template: '<div data-testid="media-asset-picker" :data-field-label="fieldLabel" :data-video-target="videoTarget" :data-asset-id="modelValue?.assetId" />',
});

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	writable?: boolean;
	contract?: GraphicsHostContract;
}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Inspector.vue';
	const { default: Inspector } = await import(componentPath);

	return mount(Inspector, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget,
			contract: options.contract ?? BROADCAST_GRAPHICS_HOST_CONTRACT,
			canvasWidth: 1920,
			canvasHeight: 1080,
			eventId: 7,
			writable: options.writable ?? true,
		},
		global: {
			stubs: {
				UFormField: SlotOnlyStub,
				USelect: USelectStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USwitch: USwitchStub,
				UTextarea: UInputStub,
				UIColorPicker: UInputStub,
				UButton: UButtonStub,
				UBadge: true,
				UIcon: true,
				// The Graphic Asset picker is the library's own component and is covered
				// by its own tests; here it stands in as the seam that reports the pinned
				// reference and any Missing or Unavailable diagnosis.
				GraphicsAssetFocusPicker: GraphicsAssetFocusPickerStub,
			},
		},
	});
}

function emittedGraphics(wrapper: Awaited<ReturnType<typeof mountComponent>>, index = 0) {
	return wrapper.emitted('update:graphics')?.[index]?.[0] as BroadcastGraphicConfig[];
}

function numberField(wrapper: Awaited<ReturnType<typeof mountComponent>>, ariaLabel: string) {
	return wrapper.findAllComponents({ name: 'UInputNumber' })
		.find(input => input.attributes('aria-label') === ariaLabel);
}

function selectField(wrapper: Awaited<ReturnType<typeof mountComponent>>, testId: string) {
	return wrapper.findAllComponents({ name: 'USelect' })
		.find(select => select.attributes('data-testid') === testId);
}

function switchField(wrapper: Awaited<ReturnType<typeof mountComponent>>, testId: string) {
	return wrapper.findAllComponents({ name: 'USwitch' })
		.find(entry => entry.attributes('data-testid') === testId);
}

function itemOf(graphics: BroadcastGraphicConfig[], index = 0) {
	return graphics[0]?.items[index];
}

function childOf(graphics: BroadcastGraphicConfig[], index = 0) {
	const group = graphics[0]?.items[0];
	return group?.type === 'group' ? group.children[index] : undefined;
}

/**
 * The Graphic Surface Style of an item that can carry one. A Media Graphic Item
 * paints an asset rather than a surface and has none, so asking narrows it away.
 */
function surfaceOf(graphics: BroadcastGraphicConfig[], index = 0) {
	const item = itemOf(graphics, index);
	return item && item.type !== 'media' ? item.surfaceStyle : undefined;
}

function childSurfaceOf(graphics: BroadcastGraphicConfig[], index = 0) {
	const child = childOf(graphics, index);
	return child && child.type !== 'media' ? child.surfaceStyle : undefined;
}

function textInput(key: string): GraphicInputDeclaration {
	return {
		type: 'text',
		key,
		label: key,
		required: false,
		updatePolicy: 'staged',
		default: '',
		maxLength: MAX_GRAPHIC_TEXT_LENGTH,
	};
}

function numberFieldByTestId(wrapper: Awaited<ReturnType<typeof mountComponent>>, testId: string) {
	return wrapper.findAllComponents({ name: 'UInputNumber' })
		.find(input => input.attributes('data-testid') === testId);
}

describe('graphicsCompositorInspector', () => {
	it('offers no Graphic Item controls while the canvas is selected', async () => {
		const wrapper = await mountComponent({ graphics: stack([shapeItem]), selectedTarget: { type: 'canvas' } });

		expect(wrapper.find('[data-testid="graphic-item-label"]').exists()).toBe(false);
		expect(wrapper.text()).toContain('1920x1080');
	});

	it('renames the selected Broadcast Graphic', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		wrapper.getComponent(UInputStub).vm.$emit('update:modelValue', 'Talent Lower Third');
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.name).toBe('Talent Lower Third');
	});

	it('shows the anchored coordinate of the selected Graphic Anchor Point', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(numberField(wrapper, 'Item x')?.props('modelValue')).toBe(300);
		expect(numberField(wrapper, 'Item y')?.props('modelValue')).toBe(250);
	});

	it('moves the stored top-left rectangle when the author edits the anchored coordinate', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Item x')?.vm.$emit('update:modelValue', 960);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]).toMatchObject({ x: 760, y: 200 });
	});

	it('holds the Graphic Anchor Point fixed while the author resizes the item', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Item width')?.vm.$emit('update:modelValue', 200);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]).toMatchObject({ x: 200, width: 200 });
	});

	it('offers a Minimum font size control only for the shrink Text Overflow Policy', async () => {
		const ellipsis = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});
		expect(ellipsis.find('[data-testid="text-min-font-size"]').exists()).toBe(false);

		const shrink = await mountComponent({
			graphics: stack([{ ...textItem, overflowPolicy: 'shrink' }]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});
		expect(shrink.find('[data-testid="text-min-font-size"]').exists()).toBe(true);
	});

	it('offers Shape Graphic Item controls but not Text ones for a shape', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="text-overflow-policy"]').exists()).toBe(false);
	});

	it('offers Text Graphic Item controls but not Shape ones for text', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.find('[data-testid="text-overflow-policy"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphic-item-text"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(false);
	});

	it('hides a Graphic Item without removing it from the Graphic Layer Order', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await wrapper.get('[data-testid="graphic-item-visible"]').trigger('click');

		expect(emittedGraphics(wrapper)[0]?.items).toHaveLength(1);
		expect(emittedGraphics(wrapper)[0]?.items[0]?.visible).toBe(false);
	});

	it('explains a selection the Screen stack no longer carries', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'gone' },
		});

		expect(wrapper.text()).toContain('Selection unavailable');
		expect(wrapper.find('[data-testid="graphic-item-label"]').exists()).toBe(false);
	});

	it('bounds the text control so an operator is stopped in the field', async () => {
		// Without this the only bound is the wire schema, and an over-long text
		// costs the operator a whole write to an opaque validation error.
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.get('[data-testid="graphic-item-text"]').attributes('maxlength'))
			.toBe(String(MAX_GRAPHIC_TEXT_LENGTH));
	});

	it('offers Graphic Rotation for a canvas-positioned item and stores its degrees', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Graphic Rotation')?.vm.$emit('update:modelValue', -6);
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ rotation: -6 });
	});

	it('configures one Shape Geometry corner without disturbing the others', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(wrapper, 'shape-corner-topRight')?.vm.$emit('update:modelValue', 'cut');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({
			geometry: {
				topRight: { treatment: 'cut' },
				topLeft: { treatment: 'square' },
			},
		});
	});

	it('slants an edge in canonical pixels', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Right edge slant')?.vm.$emit('update:modelValue', 48);
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ geometry: { rightSlant: 48 } });
	});

	it('initialises a Shape Geometry from a preset', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(wrapper, 'shape-geometry-preset')?.vm.$emit('update:modelValue', 'corner-cut');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({
			geometry: { topRight: { treatment: 'cut' }, bottomLeft: { treatment: 'cut' } },
		});
	});

	it('switches a Graphic Fill to a linear gradient and edits one of its stops', async () => {
		const gradient = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(gradient, 'graphic-fill-kind')?.vm.$emit('update:modelValue', 'linear-gradient');
		await nextTick();

		const withGradient = emittedGraphics(gradient);
		expect(itemOf(withGradient)).toMatchObject({
			surfaceStyle: { fill: { type: 'linear-gradient', angle: 90 } },
		});

		const stops = await mountComponent({
			graphics: withGradient,
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});
		expect(stops.findAll('[data-testid="graphic-fill-stop"]')).toHaveLength(2);

		// Each surface's controls name the surface they belong to, because a Game Wins
		// Item shows three sets of them at once.
		numberField(stops, 'Graphic Surface Style stop 2 opacity')?.vm.$emit('update:modelValue', 0.4);
		await nextTick();

		const patched = surfaceOf(emittedGraphics(stops));
		expect(patched?.fill.type === 'linear-gradient'
			&& patched.fill.stops[1]?.opacity).toBe(0.4);
	});

	it('adds and removes gradient stops within the bounds of the vocabulary', async () => {
		const wrapper = await mountComponent({
			graphics: stack([{
				...shapeItem,
				surfaceStyle: {
					fill: {
						type: 'linear-gradient',
						angle: 90,
						stops: [
							{ color: '#000000', position: 0, opacity: 1 },
							{ color: '#ffffff', position: 1, opacity: 1 },
						],
					},
					fillOpacity: 1,
				},
			}]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(wrapper.get('[data-testid="graphic-fill-remove-stop"]').attributes('disabled')).toBeDefined();

		await wrapper.get('[data-testid="graphic-fill-add-stop"]').trigger('click');

		const patched = surfaceOf(emittedGraphics(wrapper));
		expect(patched?.fill.type === 'linear-gradient'
			&& patched.fill.stops).toHaveLength(3);
	});

	it('adds an outline and a glow, and takes them away again', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await switchField(wrapper, 'graphic-outline-enabled')?.trigger('click');
		await switchField(wrapper, 'graphic-glow-enabled')?.trigger('click');

		expect(surfaceOf(emittedGraphics(wrapper, 0))?.outline).toMatchObject({ width: 2 });
		expect(surfaceOf(emittedGraphics(wrapper, 1))?.glow).toMatchObject({ size: 24 });

		const styled = await mountComponent({
			graphics: stack([{
				...shapeItem,
				surfaceStyle: {
					fill: { type: 'solid', color: '#0077a3' },
					fillOpacity: 1,
					outline: { color: '#ffffff', width: 4 },
				},
			}]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await switchField(styled, 'graphic-outline-enabled')?.trigger('click');

		expect(surfaceOf(emittedGraphics(styled))?.outline).toBeUndefined();
	});

	it('gives a Text Graphic Item a Graphic Surface Style of its own', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.find('[data-testid="graphic-fill-kind"]').exists()).toBe(false);

		await switchField(wrapper, 'surface-style-own')?.trigger('click');

		expect(surfaceOf(emittedGraphics(wrapper))).toMatchObject({ fillOpacity: 1 });
	});

	it('offers Graphic Group controls for a group', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'cluster' },
		});

		selectField(wrapper, 'graphic-group-arrangement')?.vm.$emit('update:modelValue', 'canvas');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ arrangement: 'canvas' });
		// A Graphic Group owns a Shape Geometry too, for its surface and its clipping.
		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphic-group-clip"]').exists()).toBe(true);
	});

	it('offers main-axis sizing instead of a coordinate for a row Graphic Group child', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupWith([shapeItem])]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(numberField(wrapper, 'Item x')).toBeUndefined();
		expect(wrapper.find('[data-testid="graphic-item-rotation"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-group-child-sizing-mode"]').exists()).toBe(true);

		selectField(wrapper, 'graphic-group-child-sizing-mode')?.vm.$emit('update:modelValue', 'fill');
		await nextTick();

		expect(childOf(emittedGraphics(wrapper))).toMatchObject({ sizing: { mode: 'fill' } });
	});

	it('projects a canvas Graphic Group child coordinate against its group bounds', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupWith(
				[{ ...shapeItem, anchor: 'top-left', x: 400, y: 100 }],
				{ arrangement: 'canvas' },
			)]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(wrapper, 'graphic-geometry-unit')?.vm.$emit('update:modelValue', 'percent');
		await nextTick();

		// The group is 800 wide, so 400px is half of the containing canvas.
		expect(numberField(wrapper, 'Item x')?.props('modelValue')).toBe(50);
	});

	it('lets a Graphic Group child override the local style default of its group', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupWith(
				[{ ...shapeItem, surfaceStyle: undefined }],
				{ defaultChildSurfaceStyle: { fill: { type: 'solid', color: '#00ff00' }, fillOpacity: 0.5 } },
			)]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		// Inheriting, so the group owns the style and the child offers no fill controls.
		expect(wrapper.find('[data-testid="graphic-fill-kind"]').exists()).toBe(false);

		await switchField(wrapper, 'surface-style-own')?.trigger('click');

		expect(childSurfaceOf(emittedGraphics(wrapper))).toMatchObject({ fillOpacity: 1 });
	});

	describe('media Graphic Items', () => {
		function mountMedia(overrides: Partial<Extract<GraphicItemConfig, { type: 'media' }>> = {}, writable = true) {
			return mountComponent({
				graphics: stack([{ ...mediaItem, ...overrides } as GraphicItemConfig]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'logo' },
				writable,
			});
		}

		function mediaOf(graphics: BroadcastGraphicConfig[], index = 0) {
			const item = itemOf(graphics, index);
			if (item?.type !== 'media')
				throw new Error('expected a Media Graphic Item');
			return item;
		}

		it('offers fitting, focal position, and opacity for any media kind', async () => {
			const wrapper = await mountMedia();

			selectField(wrapper, 'media-fit')?.vm.$emit('update:modelValue', 'contain');
			await nextTick();
			numberField(wrapper, 'Media opacity')?.vm.$emit('update:modelValue', 0.25);
			await nextTick();
			numberField(wrapper, 'Horizontal focal position')?.vm.$emit('update:modelValue', 0.2);
			await nextTick();
			numberField(wrapper, 'Vertical focal position')?.vm.$emit('update:modelValue', 0.8);
			await nextTick();

			expect(mediaOf(emittedGraphics(wrapper, 0)).fit).toBe('contain');
			expect(mediaOf(emittedGraphics(wrapper, 1)).opacity).toBe(0.25);
			expect(mediaOf(emittedGraphics(wrapper, 2)).focalPosition).toEqual({ horizontal: 0.2, vertical: 0.5 });
			expect(mediaOf(emittedGraphics(wrapper, 3)).focalPosition).toEqual({ horizontal: 0.5, vertical: 0.8 });
		});

		it('offers playback controls only for a silent video, and says it is silent', async () => {
			const image = await mountMedia();
			const video = await mountMedia({ mediaKind: 'silent-video' });

			expect(image.find('[data-testid="media-playback-rate"]').exists()).toBe(false);
			expect(image.find('[data-testid="media-loop"]').exists()).toBe(false);
			expect(video.find('[data-testid="media-playback-rate"]').exists()).toBe(true);
			expect(video.text()).toContain('silent');
			expect(video.text()).toContain('starts from its beginning');
		});

		it('edits the playback rate and looping of a silent video', async () => {
			const wrapper = await mountMedia({ mediaKind: 'silent-video' });

			numberField(wrapper, 'Playback rate')?.vm.$emit('update:modelValue', 2);
			await nextTick();
			await switchField(wrapper, 'media-loop')?.trigger('click');

			expect(mediaOf(emittedGraphics(wrapper, 0)).playbackRate).toBe(2);
			expect(mediaOf(emittedGraphics(wrapper, 1)).loop).toBe(false);
		});

		it('offers the Shape Geometry controls only once clipping is switched on', async () => {
			const unclipped = await mountMedia();

			expect(unclipped.find('[data-testid="shape-corner-topLeft"]').exists()).toBe(false);

			await switchField(unclipped, 'media-clip-enabled')?.trigger('click');
			expect(mediaOf(emittedGraphics(unclipped)).clipGeometry).toBeDefined();

			const clipped = await mountMedia({ clipGeometry: squareShapeGeometry() });
			expect(clipped.find('[data-testid="shape-corner-topLeft"]').exists()).toBe(true);

			// The canonical Shape Geometry controls, editing the clip in place.
			numberField(clipped, 'Right edge slant')?.vm.$emit('update:modelValue', 40);
			await nextTick();
			expect(mediaOf(emittedGraphics(clipped)).clipGeometry?.rightSlant).toBe(40);
		});

		it('offers no Graphic Surface Style, because a Media Graphic Item paints an asset', async () => {
			const wrapper = await mountMedia();

			expect(wrapper.find('[data-testid="surface-style-own"]').exists()).toBe(false);
			expect(wrapper.find('[data-testid="graphic-fill-kind"]').exists()).toBe(false);
			expect(wrapper.find('[data-testid="graphic-glow-enabled"]').exists()).toBe(false);
		});

		it('pins one exact revision through the asset picker, taking the media kind from the asset', async () => {
			const wrapper = await mountMedia({ asset: undefined });
			const picker = wrapper.getComponent(GraphicsAssetFocusPickerStub);

			picker.vm.$emit(
				'select',
				{ id: 'asset-2', kind: 'silent-video', facts: { kind: 'silent-video', targetCompatibility: 'chromium-transparency' } },
				{ assetId: 'asset-2', revisionId: 'revision-3' },
			);
			await nextTick();

			expect(mediaOf(emittedGraphics(wrapper))).toMatchObject({
				asset: { assetId: 'asset-2', revisionId: 'revision-3' },
				mediaKind: 'silent-video',
				videoCompatibility: 'chromium-transparency',
			});
		});

		it('unpins the asset when the picker clears it', async () => {
			const wrapper = await mountMedia();
			const picker = wrapper.getComponent(GraphicsAssetFocusPickerStub);

			picker.vm.$emit('update:modelValue', undefined);
			await nextTick();

			expect(mediaOf(emittedGraphics(wrapper)).asset).toBeUndefined();
		});

		it('asks the picker for a Chromium target, so alpha video is selectable', async () => {
			// A Broadcast Graphics Screen Output is consumed as a Chromium browser
			// source, which is the whole reason a transparent overlay works at all.
			const wrapper = await mountMedia();

			expect(wrapper.get('[data-testid="media-asset-picker"]').attributes('data-video-target')).toBe('chromium');
		});

		it('lets a read-only observer read every media property without changing one', async () => {
			const wrapper = await mountMedia({ mediaKind: 'silent-video' }, false);

			expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
			expect(wrapper.find('[data-testid="media-fit"]').exists()).toBe(true);
			expect(wrapper.find('[data-testid="media-playback-rate"]').exists()).toBe(true);

			selectField(wrapper, 'media-fit')?.vm.$emit('update:modelValue', 'contain');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
		});
	});

	it('shows a read-only observer every property without letting it change one', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			writable: false,
		});

		expect(wrapper.get('[data-testid="graphic-item-label"]').attributes('value')).toBe('Text 1');
		expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();

		wrapper.getComponent(USwitchStub).vm.$emit('update:modelValue', false);
		wrapper.findAllComponents(UInputStub).forEach(input => input.vm.$emit('update:modelValue', 'changed'));
		numberField(wrapper, 'Item width')?.vm.$emit('update:modelValue', 12);
		await nextTick();

		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});

	it('refuses a read-only observer\'s rename of the selected Broadcast Graphic', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			writable: false,
		});

		wrapper.getComponent(UInputStub).vm.$emit('update:modelValue', 'Renamed');
		await nextTick();

		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});

	describe('context-gated Graphic Items', () => {
		function contextItem(kind: 'clock' | 'player-life' | 'game-wins'): GraphicItemConfig {
			return getGraphicItemDefinition(kind).createDefault({
				id: kind,
				label: kind,
				canvasWidth: 1920,
				canvasHeight: 1080,
			});
		}

		it('chooses the Player a Player Life reads', async () => {
			// Without this, a Player Life is permanently player1 and a two-player overlay
			// cannot be built at all — both sides would render the same total.
			const wrapper = await mountComponent({
				graphics: stack([contextItem('player-life')]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'player-life' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			selectField(wrapper, 'graphic-item-player-side')?.vm.$emit('update:modelValue', 'player2');
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ type: 'player-life', playerSide: 'player2' });
		});

		it('chooses the Player a Game Wins indicator reads', async () => {
			const wrapper = await mountComponent({
				graphics: stack([contextItem('game-wins')]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'game-wins' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			selectField(wrapper, 'graphic-item-player-side')?.vm.$emit('update:modelValue', 'player2');
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ type: 'game-wins', playerSide: 'player2' });
		});

		it('offers no Player for a Clock, which belongs to the Match rather than a side', async () => {
			const wrapper = await mountComponent({
				graphics: stack([contextItem('clock')]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'clock' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			expect(selectField(wrapper, 'graphic-item-player-side')).toBeUndefined();
		});

		it('never writes a Player through a read-only session', async () => {
			const wrapper = await mountComponent({
				graphics: stack([contextItem('player-life')]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'player-life' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
				writable: false,
			});

			selectField(wrapper, 'graphic-item-player-side')?.vm.$emit('update:modelValue', 'player2');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
		});
	});

	describe('host-supplied placeholder values', () => {
		function tokenButtons(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.findAllComponents(UButtonStub)
				.filter(button => button.attributes('data-host-token') !== undefined);
		}

		it('withholds the Graphic Inputs controls from a host that binds host tokens', async () => {
			// A Feature Match Overlay's placeholder vocabulary is a fixed catalogue, so
			// there is nothing here to declare, rename, or delete. Offering the controls
			// anyway would let an author write a declaration nothing ever resolves.
			const wrapper = await mountComponent({
				graphics: stack([]),
				selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			expect(selectField(wrapper, 'graphic-input-type')).toBeUndefined();
			expect(wrapper.findAll('[data-testid="graphic-input-add"]')).toHaveLength(0);
		});

		it('keeps them for a host whose compositions declare their own', async () => {
			const wrapper = await mountComponent({
				graphics: stack([]),
				selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			});

			expect(selectField(wrapper, 'graphic-input-type')).toBeDefined();
			expect(tokenButtons(wrapper)).toHaveLength(0);
		});

		it('offers the host token catalogue to reference on a Text Graphic Item', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			const keys = tokenButtons(wrapper).map(button => button.attributes('data-host-token'));
			expect(keys).toEqual(FEATURE_MATCH_TOKEN_CATALOGUE.map(token => token.key));
		});

		it('appends a referenced token to the Graphic Text Template', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			tokenButtons(wrapper)
				.find(button => button.attributes('data-host-token') === 'player1Name')
				?.vm
				.$emit('click');
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ text: 'Commentator{player1Name}' });
		});

		it('never writes a token through a read-only session', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
				writable: false,
			});

			tokenButtons(wrapper)
				.find(button => button.attributes('data-host-token') === 'player1Name')
				?.vm
				.$emit('click');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
		});

		it('styles a host token placeholder that no Graphic Input declares', async () => {
			// The styleable set follows whichever side supplies the keys. Asking the
			// graphic's own declarations would leave every Feature Match placeholder
			// unstyleable, because a Feature Match Overlay declares none.
			const wrapper = await mountComponent({
				graphics: stack([{ ...textItem, text: 'Hi {player1Name}' } as GraphicItemConfig]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			expect(wrapper.findAll('[data-graphic-placeholder-style]').map(node =>
				node.attributes('data-graphic-placeholder-style'),
			)).toEqual(['player1Name']);
		});

		it('offers no Graphic Placeholder Style for a key this host does not supply', async () => {
			// `{name}` is a legacy Feature Match token, and the shared catalogue moved the
			// side into the key. Nothing resolves it, so styling it would style something
			// that renders nothing.
			const wrapper = await mountComponent({
				graphics: stack([{ ...textItem, text: 'Hi {name}' } as GraphicItemConfig]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			expect(wrapper.findAll('[data-graphic-placeholder-style]')).toHaveLength(0);
		});
	});

	it('declares a typed Graphic Input on the selected Broadcast Graphic', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		selectField(wrapper, 'graphic-input-type')?.vm.$emit('update:modelValue', 'number');
		await nextTick();
		wrapper.findAllComponents(UButtonStub)
			.find(button => button.attributes('data-testid') === 'graphic-input-add')
			?.vm
			.$emit('click');
		await nextTick();

		const declared = emittedGraphics(wrapper)[0]!.inputs!;
		expect(declared).toHaveLength(1);
		// Optional and staged, so an author opts into blocking Take and into immediate
		// on-air application rather than discovering either.
		expect(declared[0]).toMatchObject({ type: 'number', required: false, updatePolicy: 'staged' });
	});

	it('edits a declared Graphic Input’s label, requiredness, and On-air Update Policy', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({ ...graphic, inputs: [textInput('name')] })),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		switchField(wrapper, 'graphic-input-required')?.vm.$emit('update:modelValue', true);
		selectField(wrapper, 'graphic-input-policy')?.vm.$emit('update:modelValue', 'live');
		await nextTick();

		expect(emittedGraphics(wrapper, 0)[0]!.inputs![0]).toMatchObject({ key: 'name', required: true });
		expect(emittedGraphics(wrapper, 1)[0]!.inputs![0]).toMatchObject({ key: 'name', updatePolicy: 'live' });
	});

	it('writes nothing when an author clears a Graphic Input’s label', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({ ...graphic, inputs: [textInput('name')] })),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		wrapper.findAllComponents(UInputStub)
			.find(input => input.attributes('data-testid') === 'graphic-input-label')
			?.vm
			.$emit('update:modelValue', '');
		await nextTick();

		// A nameless Graphic Input is one the write path refuses, so a cleared field
		// leaves the Screen's mode configuration alone rather than writing it unchanged.
		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});

	it('shows the stable key a Graphic Text Template would name, and offers no way to edit it', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({ ...graphic, inputs: [textInput('name')] })),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		expect(wrapper.get('[data-testid="graphic-input-key"]').text()).toBe('{name}');
		expect(wrapper.get('[data-testid="graphic-input-key"]').element.tagName).toBe('P');
	});

	it('offers a Graphic Placeholder Style for each declared input its template names', async () => {
		const wrapper = await mountComponent({
			graphics: [{
				id: 'lower-third',
				name: 'Lower Third',
				inputs: [textInput('name')],
				items: [{ ...textItem, text: '{name} — {undeclared}' }],
			}],
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.findAll('[data-graphic-placeholder-style]').map(entry =>
			entry.attributes('data-graphic-placeholder-style'),
		)).toEqual(['name']);
	});

	it('overrides one placeholder’s typography and returns it to the item’s base', async () => {
		const wrapper = await mountComponent({
			graphics: [{
				id: 'lower-third',
				name: 'Lower Third',
				inputs: [textInput('name')],
				items: [{ ...textItem, text: '{name}', placeholderStyles: { name: { fontWeight: 300 } } }],
			}],
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		numberFieldByTestId(wrapper, 'graphic-placeholder-style-size')?.vm.$emit('update:modelValue', 24);
		await nextTick();
		wrapper.findAllComponents(UButtonStub)
			.find(button => button.attributes('data-testid') === 'graphic-placeholder-style-clear')
			?.vm
			.$emit('click');
		await nextTick();

		const styled = itemOf(emittedGraphics(wrapper, 0));
		expect(styled?.type === 'text' ? styled.placeholderStyles : undefined)
			.toEqual({ name: { fontWeight: 300, fontSize: 24 } });

		const cleared = itemOf(emittedGraphics(wrapper, 1));
		expect(cleared?.type === 'text' ? cleared.placeholderStyles : undefined).toBeUndefined();
	});

	/**
	 * A Text Graphic Item's base Graphic Font Selection.
	 *
	 * The control #141 shipped, which had no component test of its own — the placeholder
	 * one below is modelled on it, so the model is worth pinning before anything leans on
	 * it further.
	 */
	describe('a base typography font', () => {
		function typographyFontPicker(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.findAllComponents({ name: 'GraphicsAssetFocusPicker' })
				.find(picker => picker.attributes('data-field-label') === 'Typography');
		}

		function typographyOf(graphics: BroadcastGraphicConfig[]) {
			const item = itemOf(graphics);
			return item?.type === 'text' ? item.typography : undefined;
		}

		/**
		 * Two answers, not three (#167).
		 *
		 * The base typography and a Graphic Placeholder Style share one control, and the
		 * only thing that separates them is whether naming no font is an answer. A
		 * `GraphicTypography` must name one, so offering "Same as base" here would offer an
		 * answer the panel cannot render: choosing it puts the control on an arm that shows
		 * neither the application select nor the library picker, and the author is left
		 * with no font control at all until they reselect the item. So the answers each
		 * side offers are asserted rather than left to the flag.
		 */
		it('offers only the two answers a Text Graphic Item’s own typography has', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(selectField(wrapper, 'typography-font-source')?.props('items')).toEqual([
				{ label: 'Application font', value: 'application' },
				{ label: 'Library font', value: 'asset' },
			]);
			// With no third answer the control is the source, and its application arm is
			// simply the font — the labelling a placeholder cannot use.
			expect(wrapper.find('[data-label="Font source"] [data-testid="typography-font-source"]').exists()).toBe(true);
			expect(wrapper.find('[data-label="Font"] [data-testid="typography-font"]').exists()).toBe(true);
		});

		/** The asset arm needs an exact revision, so nothing is written until one is pinned. */
		it('writes no library font until the picker has pinned a revision', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'typography-font-source')?.vm.$emit('update:modelValue', 'asset');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
			expect(typographyFontPicker(wrapper)?.exists()).toBe(true);
		});

		/**
		 * The application arm writes what the author picked.
		 *
		 * The placeholder twin has had this since #161; the base control never did, and
		 * until the shared control gave its select a test id there was nothing to address
		 * it by.
		 */
		it('chooses an application font for the item', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'typography-font')?.vm.$emit('update:modelValue', 'saira-condensed');
			await nextTick();

			expect(typographyOf(emittedGraphics(wrapper, 0))?.font)
				.toEqual({ kind: 'application', fontId: 'saira-condensed' });
		});

		it('pins one exact font Graphic Asset Revision on the item', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'typography-font-source')?.vm.$emit('update:modelValue', 'asset');
			await nextTick();
			typographyFontPicker(wrapper)?.vm.$emit(
				'select',
				{ id: 'font-1', kind: 'font' },
				{ assetId: 'font-1', revisionId: 'font-revision-2' },
			);
			await nextTick();

			expect(typographyOf(emittedGraphics(wrapper, 0))?.font)
				.toEqual({ kind: 'asset', reference: { assetId: 'font-1', revisionId: 'font-revision-2' } });
		});

		/**
		 * A `GraphicTypography` must name a font, so leaving the library arm cannot leave
		 * the item on none. It lands on the application default rather than on whichever
		 * font happens to be first in the registry.
		 */
		it('returns to an application font rather than to none', async () => {
			const wrapper = await mountComponent({
				graphics: stack([{
					...textItem,
					typography: {
						...DEFAULT_GRAPHIC_TYPOGRAPHY,
						font: { kind: 'asset', reference: { assetId: 'font-1', revisionId: 'font-revision-2' } },
					},
				} as GraphicItemConfig]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(typographyFontPicker(wrapper)?.attributes('data-asset-id')).toBe('font-1');

			selectField(wrapper, 'typography-font-source')?.vm.$emit('update:modelValue', 'application');
			await nextTick();

			expect(typographyOf(emittedGraphics(wrapper, 0))?.font)
				.toEqual({ kind: 'application', fontId: 'inter' });
		});

		/**
		 * The same fallback, reached from the picker rather than from the arm.
		 *
		 * Unpinning through the picker is the other way out of the library arm, and it is
		 * where the two controls' policies differ: a placeholder loses the key, while a
		 * `GraphicTypography` must still name a font.
		 */
		it('returns to an application font when the picker unpins the revision', async () => {
			const wrapper = await mountComponent({
				graphics: stack([{
					...textItem,
					typography: {
						...DEFAULT_GRAPHIC_TYPOGRAPHY,
						font: { kind: 'asset', reference: { assetId: 'font-1', revisionId: 'font-revision-2' } },
					},
				} as GraphicItemConfig]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			typographyFontPicker(wrapper)?.vm.$emit('update:modelValue', undefined);
			await nextTick();

			expect(typographyOf(emittedGraphics(wrapper, 0))?.font)
				.toEqual({ kind: 'application', fontId: 'inter' });
		});
	});

	/**
	 * A Graphic Placeholder Style's own Graphic Font Selection (#161).
	 *
	 * Every other layer already carried one — the type, the wire schema, the reference
	 * walk, the Screen Output Asset Capability, the render model, and a Template Package
	 * — while the panel offered size, weight and colour, so the only way to author one
	 * was to write the Screen mode configuration directly.
	 *
	 * The placeholder arm has a third state the base typography does not: a font is
	 * optional here, so "same as base" is a real answer rather than the absence of one.
	 */
	describe('a Graphic Placeholder Style font', () => {
		function placeholderTextGraphic(
			placeholderStyles?: Record<string, Record<string, unknown>>,
		): BroadcastGraphicConfig[] {
			return [{
				id: 'lower-third',
				name: 'Lower Third',
				inputs: [textInput('name')],
				items: [{ ...textItem, text: '{name}', ...(placeholderStyles ? { placeholderStyles } : {}) } as GraphicItemConfig],
			}];
		}

		function placeholderFontPicker(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.findAllComponents({ name: 'GraphicsAssetFocusPicker' })
				.find(picker => picker.attributes('data-field-label') === 'Placeholder {name}');
		}

		function placeholderStylesOf(graphics: BroadcastGraphicConfig[]) {
			const item = itemOf(graphics);
			return item?.type === 'text' ? item.placeholderStyles : undefined;
		}

		/**
		 * Three answers, not two (#167).
		 *
		 * The counterpart of the base typography's assertion above. These two are the same
		 * control now, and "same as base" is the entire difference between the call sites —
		 * so if it stopped being offered here, a placeholder could never be returned to the
		 * item's base font, and nothing else in this file would notice.
		 */
		it('offers a placeholder the third answer its optional font has', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({ name: { fontWeight: 300 } }),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(selectField(wrapper, 'graphic-placeholder-style-font-source')?.props('items')).toEqual([
				{ label: 'Same as base', value: 'base' },
				{ label: 'Application font', value: 'application' },
				{ label: 'Library font', value: 'asset' },
			]);
			// And with a third answer the control itself is the font, so its application arm
			// has to name itself to be told apart from "Same as base".
			expect(wrapper.find('[data-label="Font"] [data-testid="graphic-placeholder-style-font-source"]').exists())
				.toBe(true);

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				?.vm
				.$emit('update:modelValue', 'application');
			await nextTick();

			expect(wrapper.find('[data-label="Application font"] [data-testid="graphic-placeholder-style-font"]').exists())
				.toBe(true);
		});

		it('chooses an application font for one placeholder', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({ name: { fontWeight: 300 } }),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				?.vm
				.$emit('update:modelValue', 'application');
			await nextTick();
			selectField(wrapper, 'graphic-placeholder-style-font')
				?.vm
				.$emit('update:modelValue', 'saira-condensed');
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 1)))
				.toEqual({ name: { fontWeight: 300, font: { kind: 'application', fontId: 'saira-condensed' } } });
		});

		/**
		 * The control refuses what the write path refuses, per #119. The asset arm of a
		 * Graphic Font Selection requires an exact Graphic Asset Revision, so choosing
		 * "Library font" before one is pinned would write a font that is nothing — which
		 * `graphicFontSelectionSchema` rejects. The placeholder keeps the base typography
		 * until the picker pins a revision.
		 */
		it('writes no library font until the picker has pinned a revision', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic(),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				?.vm
				.$emit('update:modelValue', 'asset');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
			expect(placeholderFontPicker(wrapper)?.exists()).toBe(true);
		});

		it('pins one exact font Graphic Asset Revision on one placeholder', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic(),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				?.vm
				.$emit('update:modelValue', 'asset');
			await nextTick();
			placeholderFontPicker(wrapper)?.vm.$emit(
				'select',
				{ id: 'font-1', kind: 'font' },
				{ assetId: 'font-1', revisionId: 'font-revision-2' },
			);
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 0))).toEqual({
				name: { font: { kind: 'asset', reference: { assetId: 'font-1', revisionId: 'font-revision-2' } } },
			});
		});

		/**
		 * Returning to the base typography removes the key rather than storing a font of
		 * nothing. A Graphic Placeholder Style is the keys an author actually changed, so
		 * an unchosen font is an absent one.
		 */
		it('returns one placeholder to the item’s base font', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: {
						fontWeight: 300,
						font: { kind: 'asset', reference: { assetId: 'font-1', revisionId: 'font-revision-2' } },
					},
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			// The stored style already says which arm it is on, so the picker is offered
			// without the author having to choose the arm first.
			expect(placeholderFontPicker(wrapper)?.attributes('data-asset-id')).toBe('font-1');

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				?.vm
				.$emit('update:modelValue', 'base');
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 0))).toEqual({ name: { fontWeight: 300 } });
		});

		/** A placeholder that has chosen no font of its own says so, and offers no picker. */
		it('starts every placeholder on the item’s base font', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({ name: { fontWeight: 300 } }),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(selectField(wrapper, 'graphic-placeholder-style-font-source')?.props('modelValue'))
				.toBe('base');
			expect(selectField(wrapper, 'graphic-placeholder-style-font')).toBeUndefined();
			expect(placeholderFontPicker(wrapper)).toBeUndefined();
		});

		/**
		 * Unpinning a library font leaves the placeholder on the base typography rather
		 * than on a font the author never chose — the base typography control has to fall
		 * back to an application font because a `GraphicTypography` must name one, and a
		 * placeholder need not. The arm stays selected, so the picker is still there to pin
		 * another revision.
		 */
		it('unpins a library font without inventing one in its place', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: {
						fontWeight: 300,
						font: { kind: 'asset', reference: { assetId: 'font-1', revisionId: 'font-revision-2' } },
					},
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			placeholderFontPicker(wrapper)?.vm.$emit('update:modelValue', undefined);
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 0))).toEqual({ name: { fontWeight: 300 } });
			expect(selectField(wrapper, 'graphic-placeholder-style-font-source')?.props('modelValue'))
				.toBe('asset');
		});

		/**
		 * The arm an author has chosen but not yet stored belongs to the placeholder they
		 * chose it on. Carrying it across a selection would leave the control describing
		 * the previous item's placeholders — offering a library font picker on a
		 * placeholder whose stored style says nothing of the kind.
		 */
		it('forgets an unstored arm when the selection moves', async () => {
			const second = {
				...textItem,
				id: 'subhead',
				label: 'Text 2',
				text: '{name}',
			} as GraphicItemConfig;
			const wrapper = await mountComponent({
				graphics: [{
					id: 'lower-third',
					name: 'Lower Third',
					inputs: [textInput('name')],
					items: [{ ...textItem, text: '{name}' } as GraphicItemConfig, second],
				}],
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				?.vm
				.$emit('update:modelValue', 'asset');
			await nextTick();
			expect(placeholderFontPicker(wrapper)?.exists()).toBe(true);

			await wrapper.setProps({
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'subhead' },
			});
			await nextTick();

			expect(selectField(wrapper, 'graphic-placeholder-style-font-source')?.props('modelValue'))
				.toBe('base');
			expect(placeholderFontPicker(wrapper)).toBeUndefined();
		});

		/** An emptied Graphic Placeholder Style is the absence of one, not an empty one. */
		it('drops a Graphic Placeholder Style whose last property it removes', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: { font: { kind: 'application', fontId: 'inter' } },
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				?.vm
				.$emit('update:modelValue', 'base');
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 0))).toBeUndefined();
		});
	});

	/**
	 * Where the Event Data authoring surface is allowed to appear.
	 *
	 * With the Broadcast Graphic itself selected, beside the Graphic Inputs its
	 * bindings map — and nowhere a host supplies its own placeholder values, because a
	 * Graphic Input Binding maps a declared Graphic Input to a field and that host
	 * declares none.
	 */
	it('authors Graphic Source Selections beside the Graphic Inputs they feed', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({ ...graphic, inputs: [textInput('name')] })),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		expect(wrapper.find('[data-testid="graphic-event-data-bindings"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphic-source-add"]').exists()).toBe(true);
	});

	it('withholds them from a host that binds host tokens', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
		});

		expect(wrapper.find('[data-testid="graphic-event-data-bindings"]').exists()).toBe(false);
	});

	it('refuses a read-only observer’s Graphic Input declaration', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			writable: false,
		});

		wrapper.findAllComponents(UButtonStub)
			.find(button => button.attributes('data-testid') === 'graphic-input-add')
			?.vm
			.$emit('click');
		await nextTick();

		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});
	describe('the context-gated Feature Match Definitions', () => {
		/**
		 * A Feature Match Layout holding one item of a context-gated kind. Authored
		 * under the Feature Match Overlay Host Contract, because that is the only host
		 * that can supply the context these Definitions require.
		 */
		function featureMatchStack(kind: 'clock' | 'player-life' | 'game-wins') {
			return stack([getGraphicItemDefinition(kind).createDefault({
				id: kind,
				label: kind,
				canvasWidth: 1920,
				canvasHeight: 1080,
			})]);
		}

		function mountKind(kind: 'clock' | 'player-life' | 'game-wins', graphics = featureMatchStack(kind)) {
			return mountComponent({
				graphics,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: kind },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});
		}

		it.each(['clock', 'player-life', 'game-wins'] as const)('sets the base typography of a %s Item', async (kind) => {
			// A Game Wins Item paints text only while it renders its win count.
			const graphics = featureMatchStack(kind);
			const item = graphics[0]!.items[0]!;
			if (item.type === 'game-wins')
				item.displayMode = 'number';

			const wrapper = await mountKind(kind, graphics);
			numberField(wrapper, 'Font size')?.vm.$emit('update:modelValue', 96);
			await nextTick();

			const patched = itemOf(emittedGraphics(wrapper));
			expect(patched?.type === kind && patched.typography.fontSize).toBe(96);
		});

		it.each(['clock', 'player-life'] as const)('bounds a %s Item with a Text Overflow Policy', async (kind) => {
			const wrapper = await mountKind(kind);

			selectField(wrapper, 'text-overflow-policy')?.vm.$emit('update:modelValue', 'shrink');
			await nextTick();

			const item = itemOf(emittedGraphics(wrapper));
			expect(item?.type === kind && item.overflowPolicy).toBe('shrink');

			// The floor a shrink policy stops at only appears once shrinking is what happens.
			const shrinking = await mountKind(kind, emittedGraphics(wrapper));
			numberFieldByTestId(shrinking, 'text-min-font-size')?.vm.$emit('update:modelValue', 30);
			await nextTick();

			const bounded = itemOf(emittedGraphics(shrinking));
			expect(bounded?.type === kind && bounded.minFontSize).toBe(30);
		});

		it.each(['clock', 'player-life', 'game-wins'] as const)('gives a %s Item a Graphic Surface Style of its own', async (kind) => {
			const wrapper = await mountKind(kind);

			await switchField(wrapper, 'surface-style-own')?.trigger('click');

			const item = itemOf(emittedGraphics(wrapper));
			expect(item?.type !== 'media' && item?.surfaceStyle).toMatchObject({ fillOpacity: 1 });
		});

		it('sets the life-change animation a Player Life Item marks a change with', async () => {
			const wrapper = await mountKind('player-life');

			selectField(wrapper, 'player-life-animation')?.vm.$emit('update:modelValue', 'pop');
			await nextTick();
			numberFieldByTestId(wrapper, 'player-life-animation-duration')?.vm.$emit('update:modelValue', 800);
			await nextTick();
			// The colour a glow or slide change tints; the other animations ignore it.
			wrapper.findAllComponents(UInputStub)
				.find(input => input.attributes('data-testid') === 'player-life-animation-accent')
				?.vm
				.$emit('update:modelValue', '#ff0055');
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper, 0))).toMatchObject({ lifeAnimation: 'pop' });
			expect(itemOf(emittedGraphics(wrapper, 1))).toMatchObject({ lifeAnimationDurationMs: 800 });
			expect(itemOf(emittedGraphics(wrapper, 2))).toMatchObject({ lifeAnimationAccentColor: '#ff0055' });
		});

		it('sets a Game Wins Item’s win box orientation, dimensions, and gap', async () => {
			const wrapper = await mountKind('game-wins');

			selectField(wrapper, 'game-wins-box-orientation')?.vm.$emit('update:modelValue', 'vertical');
			await nextTick();
			numberField(wrapper, 'Win box width')?.vm.$emit('update:modelValue', 40);
			await nextTick();
			numberField(wrapper, 'Win box height')?.vm.$emit('update:modelValue', 12);
			await nextTick();
			numberField(wrapper, 'Win box gap')?.vm.$emit('update:modelValue', 3);
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper, 0))).toMatchObject({ boxOrientation: 'vertical' });
			expect(itemOf(emittedGraphics(wrapper, 1))).toMatchObject({ boxWidth: 40 });
			expect(itemOf(emittedGraphics(wrapper, 2))).toMatchObject({ boxHeight: 12 });
			expect(itemOf(emittedGraphics(wrapper, 3))).toMatchObject({ boxGap: 3 });
		});

		it('shows a Game Wins Item the boxes it renders, and only while it renders them', async () => {
			// The `number` display mode paints a win count: there is no box to orient,
			// size, shape, or paint, and the authored values survive the switch.
			const boxes = await mountKind('game-wins');
			expect(boxes.find('[data-testid="game-wins-box-orientation"]').exists()).toBe(true);
			expect(boxes.find('[data-testid="game-wins-box-shape-fill"]').exists()).toBe(true);
			expect(boxes.find('[data-testid="game-wins-won-box-shape-fill"]').exists()).toBe(true);
			expect(boxes.find('[data-testid="shape-geometry-preset"]').exists()).toBe(true);

			selectField(boxes, 'game-wins-display-mode')?.vm.$emit('update:modelValue', 'number');
			await nextTick();

			const number = await mountKind('game-wins', emittedGraphics(boxes));
			expect(number.find('[data-testid="game-wins-box-orientation"]').exists()).toBe(false);
			expect(number.find('[data-testid="game-wins-box-shape-fill"]').exists()).toBe(false);
			expect(number.find('[data-testid="game-wins-won-box-shape-fill"]').exists()).toBe(false);
			expect(number.find('[data-testid="shape-geometry-preset"]').exists()).toBe(false);
			// Typography goes the other way: a Game Wins Item paints text only in the
			// `number` mode, so offering it beside the boxes would be a whole block of
			// controls that change nothing on screen.
			expect(numberField(boxes, 'Font size')).toBeUndefined();
			expect(numberField(number, 'Font size')).toBeDefined();
		});

		it('paints a Game Wins Item’s unwon and won boxes independently', async () => {
			// An unwon box reads as an empty outline and a won one as a filled pip, which
			// is the distinction the indicator exists to make.
			const wrapper = await mountKind('game-wins');

			wrapper.findAllComponents(UInputStub)
				.find(input => input.attributes('data-testid') === 'game-wins-box-shape-fill')
				?.vm
				.$emit('update:modelValue', '#123456');
			await nextTick();
			await switchField(wrapper, 'game-wins-won-box-graphic-glow-enabled')?.trigger('click');

			const unwon = itemOf(emittedGraphics(wrapper, 0));
			expect(unwon?.type === 'game-wins' && unwon.boxSurfaceStyle.fill).toEqual({ type: 'solid', color: '#123456' });
			// Neither edit reached the other surface.
			expect(unwon?.type === 'game-wins' && unwon.wonBoxSurfaceStyle.fill).toEqual({ type: 'solid', color: '#22c55e' });

			const won = itemOf(emittedGraphics(wrapper, 1));
			expect(won?.type === 'game-wins' && won.wonBoxSurfaceStyle.glow).toBeDefined();
			expect(won?.type === 'game-wins' && won.boxSurfaceStyle.glow).toBeUndefined();
		});

		it('shapes a Game Wins Item’s win box rather than its own bounds', async () => {
			const wrapper = await mountKind('game-wins');

			selectField(wrapper, 'shape-corner-topRight')?.vm.$emit('update:modelValue', 'cut');
			await nextTick();

			const item = itemOf(emittedGraphics(wrapper));
			expect(item?.type === 'game-wins' && item.boxGeometry.topRight.treatment).toBe('cut');
			expect(item).toMatchObject({ width: 768, height: 108 });
		});

		it('sizes a context-gated Item inside a row Graphic Group like any other child', async () => {
			// A Clock is an ordinary Graphic Group child, so its main-axis sizing is
			// the group's to decide in exactly the way a Text Item's is.
			const clock = getGraphicItemDefinition('clock').createDefault({
				id: 'clock',
				label: 'Clock',
				canvasWidth: 800,
				canvasHeight: 200,
			});
			const wrapper = await mountComponent({
				graphics: stack([groupWith([clock as never])]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'clock' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			selectField(wrapper, 'graphic-group-child-sizing-mode')?.vm.$emit('update:modelValue', 'fill');
			await nextTick();

			expect(childOf(emittedGraphics(wrapper))).toMatchObject({ sizing: { mode: 'fill' } });
		});

		it('offers no win box or life-change control to a kind that has none', async () => {
			const wrapper = await mountComponent({
				graphics: stack([shapeItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
			});

			expect(wrapper.find('[data-testid="game-wins-display-mode"]').exists()).toBe(false);
			expect(wrapper.find('[data-testid="player-life-animation"]').exists()).toBe(false);
			expect(wrapper.find('[data-testid="game-wins-box-shape-fill"]').exists()).toBe(false);
			expect(numberField(wrapper, 'Font size')).toBeUndefined();
		});
	});
});
