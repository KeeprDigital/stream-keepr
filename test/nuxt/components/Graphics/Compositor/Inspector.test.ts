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
import { DEFAULT_GRAPHIC_TYPOGRAPHY, squareShapeGeometry } from '~~/shared/modules/graphics';
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

const SlotOnlyStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div><span>{{ label }}</span><slot /></div>',
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
		assetKind: { type: [String, Array], required: false },
		videoTarget: { type: String, required: false },
	},
	emits: ['update:modelValue', 'select'],
	template: '<div data-testid="media-asset-picker" :data-video-target="videoTarget" :data-asset-id="modelValue?.assetId" />',
});

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	writable?: boolean;
}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Inspector.vue';
	const { default: Inspector } = await import(componentPath);

	return mount(Inspector, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget,
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

		numberField(stops, 'Stop 2 opacity')?.vm.$emit('update:modelValue', 0.4);
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
});
