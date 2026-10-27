import type { GraphicsHostContract, GraphicThemeTokens } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GraphicGroupItemConfig,
	GraphicInputDeclaration,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicSurfaceStyle,
	MediaGraphicInputDeclaration,
	ShapeGeometry,
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
	GRAPHIC_ITEM_KINDS,
	isGraphicItemDefinitionAvailable,
	resolveGraphicThemeTokens,
	squareShapeGeometry,
} from '~~/shared/modules/graphics';
import { MAX_GRAPHIC_TEXT_LENGTH } from '~~/shared/types/graphics';
import Inspector from '~/components/Graphics/Compositor/Inspector.vue';

enableAutoUnmount(afterEach);
// The Geometry Unit is remembered per browser; no test inherits another's choice.
afterEach(() => localStorage.clear());

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
	surfaceStyle: {
		fill: { type: 'solid', color: '#0077a3' },
		fillOpacity: 1,
	},
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
	return {
		...groupItem,
		children,
		...overrides,
	};
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

const socialNetworkIconItem: GraphicItemConfig = {
	type: 'social-network-icon',
	id: 'social-icon',
	label: 'Social Network Icon 1',
	visible: true,
	anchor: 'top-left',
	x: 40,
	y: 60,
	width: 96,
	height: 96,
	network: 'twitch',
	color: '#9146ff',
	opacity: 0.75,
};

function stack(items: GraphicItemConfig[]): BroadcastGraphicConfig[] {
	return [
		{ id: 'lower-third', name: 'Lower Third', items },
	];
}

// Stands in for `UFormField`.
const SlotOnlyStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<div :data-label="label"><span>{{ label }}</span><slot /></div>',
});

/** Always open, so collapsed sections' controls are reachable. */
const UCollapsibleStub = defineComponent({
	template: '<div><slot :open="true" /><slot name="content" /></div>',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: {
			type: [String, Number],
			required: false,
		},
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" />',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const UInputStub = defineComponent({
	name: 'UInput',
	props: {
		modelValue: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" />',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

// Stands in for the Graphic Asset picker, reflecting the reference it was handed so a test can ask
// what the panel pinned rather than what the library rendered.
const GraphicsAssetFocusPickerStub = defineComponent({
	name: 'GraphicsAssetFocusPicker',
	inheritAttrs: false,
	props: {
		modelValue: { type: Object, required: false },
		eventId: { type: Number, required: false },
		fieldLabel: { type: String, required: false },
		assetKind: {
			type: [String, Array],
			required: false,
		},
	},
	emits: ['update:modelValue', 'select'],
	template: '<div v-bind="$attrs" :data-testid="$attrs[\'data-testid\'] ?? \'media-asset-picker\'" :data-field-label="fieldLabel" :data-asset-id="modelValue?.assetId" />',
});

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	writable?: boolean;
	contract?: GraphicsHostContract;
	/** The Foundation Tokens the editor previews under. */
	themeTokens?: GraphicThemeTokens;
}) {
	return mount(Inspector, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget,
			contract: options.contract ?? BROADCAST_GRAPHICS_HOST_CONTRACT,
			canvasWidth: 1920,
			canvasHeight: 1080,
			eventId: 7,
			writable: options.writable ?? true,
			themeTokens: options.themeTokens,
		},
		global: {
			stubs: {
				UFormField: SlotOnlyStub,
				UCollapsible: UCollapsibleStub,
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

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/** The one control of a kind whose attribute matches, or undefined; see `control` for the throwing form. */
function findControl(wrapper: Wrapper, name: string, attribute: string, value: string) {
	return wrapper.findAllComponents({ name }).find(entry => entry.attributes(attribute) === value);
}

/** Throws rather than answering undefined, so an emit aimed at a missing control cannot pass vacuously. */
function control(wrapper: Wrapper, name: string, attribute: string, value: string) {
	const found = findControl(wrapper, name, attribute, value);
	if (!found)
		throw new Error(`No ${name} with ${attribute}="${value}"`);
	return found;
}

function numberField(wrapper: Wrapper, ariaLabel: string) {
	return control(wrapper, 'UInputNumber', 'aria-label', ariaLabel);
}

function selectField(wrapper: Wrapper, testId: string) {
	return control(wrapper, 'USelect', 'data-testid', testId);
}

function switchField(wrapper: Wrapper, testId: string) {
	return control(wrapper, 'USwitch', 'data-testid', testId);
}

function itemOf(graphics: BroadcastGraphicConfig[], index = 0) {
	return graphics[0]?.items[index];
}

function childOf(graphics: BroadcastGraphicConfig[], index = 0) {
	const group = graphics[0]?.items[0];
	return group?.type === 'group'
		? group.children[index]
		: undefined;
}

// The Graphic Surface Style of an item that can carry one.
function surfaceOf(graphics: BroadcastGraphicConfig[], index = 0) {
	const item = itemOf(graphics, index);
	return item && item.type !== 'media' && item.type !== 'social-network-icon' && item.type !== 'deck-list'
		? item.surfaceStyle
		: undefined;
}

function childSurfaceOf(graphics: BroadcastGraphicConfig[], index = 0) {
	const child = childOf(graphics, index);
	return child && child.type !== 'media' && child.type !== 'social-network-icon' && child.type !== 'deck-list'
		? child.surfaceStyle
		: undefined;
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

function choiceInput(key: string, options: { value: string; label: string }[], fallback: string | null = null): GraphicInputDeclaration {
	return {
		type: 'choice',
		key,
		label: key,
		required: false,
		updatePolicy: 'staged',
		default: fallback,
		options,
	};
}

function mediaInput(key: string, overrides: Partial<MediaGraphicInputDeclaration> = {}): GraphicInputDeclaration {
	return {
		type: 'media',
		key,
		label: key,
		required: false,
		updatePolicy: 'staged',
		default: null,
		mediaKind: 'image',
		...overrides,
	};
}

/** The one declaration a Graphic Inputs panel edit emitted, at the given emission. */
function declarationOf(wrapper: Awaited<ReturnType<typeof mountComponent>>, index = 0) {
	return emittedGraphics(wrapper, index)[0]!.inputs![0];
}

function numberFieldByTestId(wrapper: Wrapper, testId: string) {
	return control(wrapper, 'UInputNumber', 'data-testid', testId);
}

describe('graphicsCompositorInspector', () => {
	it('offers no Graphic Item controls while the canvas is selected', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'canvas' },
		});

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

	it('moves the stored top-left rectangle when the author edits the anchored coordinate', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Item x').vm.$emit('update:modelValue', 960);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]).toMatchObject({ x: 760, y: 200 });
	});

	it('does not carry a width and height link over to the next selected item', async () => {
		const wrapper = await mountComponent({
			graphics: stack([
				shapeItem,
				{ ...shapeItem, id: 'other', anchor: 'top-left' },
			]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await wrapper.get('button[aria-label="Link width and height"]').trigger('click');
		await wrapper.setProps({
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'other' },
		});
		numberField(wrapper, 'Item width').vm.$emit('update:modelValue', 200);
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper), 1)).toMatchObject({ width: 200, height: 100 });
	});

	it('offers no width and height link for a row Graphic Group child, whose group sizes it', async () => {
		const wrapper = await mountComponent({
			graphics: stack([
				groupWith([shapeItem]),
			]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(wrapper.find('button[aria-label="Link width and height"]').exists()).toBe(false);
	});

	it('offers a Minimum font size control only for the shrink Text Overflow Policy', async () => {
		const ellipsis = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});
		expect(ellipsis.find('[data-testid="text-min-font-size"]').exists()).toBe(false);

		const shrink = await mountComponent({
			graphics: stack([
				{ ...textItem, overflowPolicy: 'shrink' },
			]),
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
		expect(wrapper.find('[data-testid="graphic-item-text"]').exists()).toBe(false);
	});

	it('offers Text Graphic Item controls but not Shape ones for text', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

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

		numberField(wrapper, 'Graphic Rotation').vm.$emit('update:modelValue', -6);
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ rotation: -6 });
	});

	it('configures one Shape Geometry corner without disturbing the others', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await wrapper.get('[data-testid="shape-corner-topRight"] [data-treatment-option="cut"]').trigger('click');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({
			geometry: {
				topRight: { treatment: 'cut' },
				topLeft: { treatment: 'square' },
			},
		});
	});

	it('initialises a Shape Geometry from a preset', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await wrapper.get('[data-testid="shape-geometry-preset-corner-cut"]').trigger('click');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({
			geometry: {
				topRight: { treatment: 'cut' },
				bottomLeft: { treatment: 'cut' },
			},
		});
	});

	it('switches a Graphic Fill to a linear gradient and edits one of its stops', async () => {
		const gradient = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(gradient, 'graphic-fill-kind').vm.$emit('update:modelValue', 'linear-gradient');
		await nextTick();

		const withGradient = emittedGraphics(gradient);
		expect(itemOf(withGradient)).toMatchObject({
			surfaceStyle: {
				fill: { type: 'linear-gradient', angle: 90 },
			},
		});

		const stops = await mountComponent({
			graphics: withGradient,
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});
		expect(stops.findAll('[data-testid="graphic-fill-stop"]')).toHaveLength(2);

		// Each surface's controls name the surface they belong to, because a Game Wins
		// Item shows three sets of them at once.
		numberField(stops, 'Graphic Surface Style stop 2 opacity').vm.$emit('update:modelValue', 0.4);
		await nextTick();

		const patched = surfaceOf(emittedGraphics(stops));
		expect(patched?.fill.type === 'linear-gradient'
			&& patched.fill.stops[1]?.opacity).toBe(0.4);
	});

	it('adds an outline and a glow, and takes them away again', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await switchField(wrapper, 'graphic-outline-enabled').trigger('click');
		await switchField(wrapper, 'graphic-glow-enabled').trigger('click');

		expect(surfaceOf(emittedGraphics(wrapper, 0))?.outline).toMatchObject({ width: 2 });
		expect(surfaceOf(emittedGraphics(wrapper, 1))?.glow).toMatchObject({ size: 24 });

		const styled = await mountComponent({
			graphics: stack([
				{
					...shapeItem,
					surfaceStyle: {
						fill: { type: 'solid', color: '#0077a3' },
						fillOpacity: 1,
						outline: { color: '#ffffff', width: 4 },
					},
				},
			]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await switchField(styled, 'graphic-outline-enabled').trigger('click');

		expect(surfaceOf(emittedGraphics(styled))?.outline).toBeUndefined();
	});

	it('gives a Text Graphic Item a Graphic Surface Style of its own', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.find('[data-testid="graphic-fill-kind"]').exists()).toBe(false);

		await switchField(wrapper, 'surface-style-own').trigger('click');

		expect(surfaceOf(emittedGraphics(wrapper))).toMatchObject({ fillOpacity: 1 });
	});

	it('offers Graphic Group controls for a group', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'cluster' },
		});

		await wrapper.get('[data-testid="graphic-group-arrangement"] [data-testid="tab-canvas"]').trigger('click');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ arrangement: 'canvas' });
		// A Graphic Group owns a Shape Geometry too, for its surface and its clipping.
		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphic-group-clip"]').exists()).toBe(true);
	});

	it('offers main-axis sizing instead of a coordinate for a row Graphic Group child', async () => {
		const wrapper = await mountComponent({
			graphics: stack([
				groupWith([shapeItem]),
			]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(findControl(wrapper, 'UInputNumber', 'aria-label', 'Item x')).toBeUndefined();
		expect(wrapper.find('[data-testid="graphic-item-rotation"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-group-child-sizing-mode"]').exists()).toBe(true);

		selectField(wrapper, 'graphic-group-child-sizing-mode').vm.$emit('update:modelValue', 'fill');
		await nextTick();

		expect(childOf(emittedGraphics(wrapper))).toMatchObject({
			sizing: { mode: 'fill' },
		});
	});

	it('projects a canvas Graphic Group child coordinate against its group bounds', async () => {
		const wrapper = await mountComponent({
			graphics: stack([
				groupWith(
					[
						{
							...shapeItem,
							anchor: 'top-left',
							x: 400,
							y: 100,
						},
					],
					{ arrangement: 'canvas' },
				),
			]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await wrapper.get('button[title="Percent of the container"]').trigger('click');

		// The group is 800 wide, so 400px is half of the containing canvas.
		expect(numberField(wrapper, 'Item x').props('modelValue')).toBe(50);
	});

	it('aligns a canvas Graphic Group child\'s edge with its group bounds', async () => {
		const wrapper = await mountComponent({
			graphics: stack([
				groupWith(
					[
						{
							...shapeItem,
							x: 100,
							y: 20,
							width: 300,
							height: 60,
						},
					],
					{ arrangement: 'canvas' },
				),
			]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await wrapper.get('button[aria-label="Hard right"]').trigger('click');
		await wrapper.get('button[aria-label="Hard bottom"]').trigger('click');

		// The group is 800×200, not the 1920×1080 canvas.
		expect(childOf(emittedGraphics(wrapper, 0))).toMatchObject({ x: 500 });
		expect(childOf(emittedGraphics(wrapper, 1))).toMatchObject({ y: 140 });
	});

	it('offers no align actions for a row Graphic Group child, whose group positions it', async () => {
		const wrapper = await mountComponent({
			graphics: stack([
				groupWith([shapeItem]),
			]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(wrapper.find('button[aria-label="Hard left"]').exists()).toBe(false);
		expect(findControl(wrapper, 'UInputNumber', 'aria-label', 'Item width')).toBeDefined();
	});

	it('lets a Graphic Group child override the local style default of its group', async () => {
		const wrapper = await mountComponent({
			graphics: stack([
				groupWith(
					[
						{ ...shapeItem, surfaceStyle: undefined },
					],
					{
						defaultChildSurfaceStyle: {
							fill: { type: 'solid', color: '#00ff00' },
							fillOpacity: 0.5,
						},
					},
				),
			]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		// Inheriting, so the group owns the style and the child offers no fill controls.
		expect(wrapper.find('[data-testid="graphic-fill-kind"]').exists()).toBe(false);

		await switchField(wrapper, 'surface-style-own').trigger('click');

		expect(childSurfaceOf(emittedGraphics(wrapper))).toMatchObject({ fillOpacity: 1 });
	});

	describe('media Graphic Items', () => {
		function mountMedia(overrides: Partial<Extract<GraphicItemConfig, { type: 'media' }>> = {}, writable = true) {
			return mountComponent({
				graphics: stack([
					{
						...mediaItem,
						...overrides,
					} as GraphicItemConfig,
				]),
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

			selectField(wrapper, 'media-fit').vm.$emit('update:modelValue', 'contain');
			await nextTick();
			numberField(wrapper, 'Media opacity').vm.$emit('update:modelValue', 0.25);
			await nextTick();
			numberField(wrapper, 'Horizontal focal position').vm.$emit('update:modelValue', 0.2);
			await nextTick();
			numberField(wrapper, 'Vertical focal position').vm.$emit('update:modelValue', 0.8);
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

			numberField(wrapper, 'Playback rate').vm.$emit('update:modelValue', 2);
			await nextTick();
			await switchField(wrapper, 'media-loop').trigger('click');

			expect(mediaOf(emittedGraphics(wrapper, 0)).playbackRate).toBe(2);
			expect(mediaOf(emittedGraphics(wrapper, 1)).loop).toBe(false);
		});

		it('returns a cleared opacity or playback rate to its default', async () => {
			const wrapper = await mountMedia({ mediaKind: 'silent-video', opacity: 0.4, playbackRate: 2 });

			numberField(wrapper, 'Media opacity').vm.$emit('update:modelValue', null);
			await nextTick();
			numberField(wrapper, 'Playback rate').vm.$emit('update:modelValue', null);
			await nextTick();

			expect(mediaOf(emittedGraphics(wrapper, 0)).opacity).toBe(1);
			expect(mediaOf(emittedGraphics(wrapper, 1)).playbackRate).toBe(1);
		});

		it('offers the Shape Geometry controls only once clipping is switched on', async () => {
			const unclipped = await mountMedia();

			expect(unclipped.find('[data-testid="shape-corner-topLeft"]').exists()).toBe(false);

			await switchField(unclipped, 'media-clip-enabled').trigger('click');
			expect(mediaOf(emittedGraphics(unclipped)).clipGeometry).toBeDefined();

			const clipped = await mountMedia({
				clipGeometry: squareShapeGeometry(),
			});
			expect(clipped.find('[data-testid="shape-corner-topLeft"]').exists()).toBe(true);

			// The canonical Shape Geometry controls, editing the clip in place.
			numberField(clipped, 'Right edge slant').vm.$emit('update:modelValue', 40);
			await nextTick();
			expect(mediaOf(emittedGraphics(clipped)).clipGeometry?.rightSlant).toBe(40);
		});

		it('pins one exact revision through the asset picker, taking the media kind from the asset', async () => {
			const wrapper = await mountMedia({ asset: undefined });
			const picker = wrapper.getComponent(GraphicsAssetFocusPickerStub);

			picker.vm.$emit(
				'select',
				{
					id: 'asset-2',
					kind: 'silent-video',
					facts: { kind: 'silent-video', targetCompatibility: 'chromium-transparency' },
				},
				{ assetId: 'asset-2', revisionId: 'revision-3' },
			);
			await nextTick();

			expect(mediaOf(emittedGraphics(wrapper))).toMatchObject({
				asset: { assetId: 'asset-2', revisionId: 'revision-3' },
				mediaKind: 'silent-video',
			});
			expect(mediaOf(emittedGraphics(wrapper))).not.toHaveProperty('videoCompatibility');
		});

		it('unpins the asset when the picker clears it', async () => {
			const wrapper = await mountMedia();
			const picker = wrapper.getComponent(GraphicsAssetFocusPickerStub);

			picker.vm.$emit('update:modelValue', undefined);
			await nextTick();

			expect(mediaOf(emittedGraphics(wrapper)).asset).toBeUndefined();
		});

		it('hands the picker the exact revision this item pins, so it diagnoses against this item', async () => {
			const wrapper = await mountMedia();

			// Missing and Unavailable are reported against the reference the picker holds;
			// an item that stopped handing its own over would have the picker offering a
			// clean slate while the item goes on rendering a broken asset.
			expect(wrapper.getComponent(GraphicsAssetFocusPickerStub).props('modelValue'))
				.toEqual({ assetId: 'asset-1', revisionId: 'revision-1' });
		});

		it('lets a read-only observer read every media property without changing one', async () => {
			const wrapper = await mountMedia({ mediaKind: 'silent-video' }, false);

			expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
			expect(wrapper.find('[data-testid="media-fit"]').exists()).toBe(true);
			expect(wrapper.find('[data-testid="media-playback-rate"]').exists()).toBe(true);

			selectField(wrapper, 'media-fit').vm.$emit('update:modelValue', 'contain');
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
		numberField(wrapper, 'Item width').vm.$emit('update:modelValue', 12);
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
		function contextItem(kind: 'clock' | 'player-life' | 'game-wins' | 'deck-list'): GraphicItemConfig {
			return getGraphicItemDefinition(kind).createDefault({
				id: kind,
				label: kind,
				canvasWidth: 1920,
				canvasHeight: 1080,
			});
		}

		it('never writes a Player through a read-only session', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					contextItem('player-life'),
				]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'player-life' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
				writable: false,
			});

			selectField(wrapper, 'graphic-item-player-side').vm.$emit('update:modelValue', 'player2');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
		});
	});

	describe('social network icon Graphic Items', () => {
		function selectedIcon() {
			return mountComponent({
				graphics: stack([socialNetworkIconItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'social-icon' },
			});
		}

		it('offers the complete Supported Social Network catalog', async () => {
			const wrapper = await selectedIcon();
			const network = findControl(wrapper, 'USelect', 'data-testid', 'social-network-icon-network');

			expect(network?.props('items')).toEqual([
				{ label: 'Twitch', value: 'twitch' },
				{ label: 'YouTube', value: 'youtube' },
				{ label: 'X', value: 'x' },
				{ label: 'Instagram', value: 'instagram' },
				{ label: 'TikTok', value: 'tiktok' },
				{ label: 'Bluesky', value: 'bluesky' },
			]);

			network!.vm.$emit('update:modelValue', 'youtube');
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper))).toMatchObject({
				type: 'social-network-icon',
				network: 'youtube',
				color: '#9146ff',
				opacity: 0.75,
			});
		});

		it('binds the icon to the current network of one declared projection', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					groupWith(
						[
							{
								...socialNetworkIconItem,
								network: { projectionKey: 'left-profile' },
							},
						],
						{ id: 'left-group' },
					),
				])
					.map(graphic => ({
						...graphic,
						socialProfileProjections: [
							{
								key: 'left-profile',
								label: 'Left profile',
								sourceKey: 'left',
								presentationGroupId: 'left-group',
								dwellMs: 8_000,
								transition: 'crossfade',
								transitionDurationMs: 250,
							},
							{
								key: 'right-profile',
								label: 'Right profile',
								sourceKey: 'right',
								presentationGroupId: 'right-group',
								dwellMs: 8_000,
								transition: 'crossfade',
								transitionDurationMs: 250,
							},
						],
					})),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'social-icon' },
			});

			expect(selectField(wrapper, 'social-network-icon-source').props('items')).toEqual([
				{ label: 'Static network', value: 'static' },
				{ label: 'Social Profile Projection', value: 'projection' },
			]);
			expect(selectField(wrapper, 'social-network-icon-projection').props('items')).toEqual([
				{ label: 'Left profile', value: 'left-profile' },
			]);

			selectField(wrapper, 'social-network-icon-projection').vm.$emit('update:modelValue', 'left-profile');
			await nextTick();
			expect(childOf(emittedGraphics(wrapper))).toMatchObject({
				network: { projectionKey: 'left-profile' },
			});
		});

		it('reports a dynamic icon outside its projection Presentation Group', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					{
						...socialNetworkIconItem,
						network: { projectionKey: 'profile' },
					},
				])
					.map(graphic => ({
						...graphic,
						socialProfileProjections: [
							{
								key: 'profile',
								label: 'Profile',
								sourceKey: 'talent',
								presentationGroupId: 'group',
								dwellMs: 8_000,
								transition: 'crossfade',
								transitionDurationMs: 250,
							},
						],
					})),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'social-icon' },
			});

			expect(selectField(wrapper, 'social-network-icon-projection').props('items')).toEqual([]);
			expect(wrapper.get('[data-testid="social-network-icon-projection-invalid"]').text())
				.toContain('outside that projection\'s Presentation Group');
		});

		it('edits colour and opacity independently of the shared geometry and visibility controls', async () => {
			const wrapper = await selectedIcon();

			wrapper.get('[data-testid="social-network-icon-color"]').getComponent(UInputStub).vm.$emit('update:modelValue', '#ffcc00');
			await nextTick();
			expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ color: '#ffcc00', opacity: 0.75 });

			await wrapper.setProps({
				graphics: emittedGraphics(wrapper),
			});
			numberFieldByTestId(wrapper, 'social-network-icon-opacity').vm.$emit('update:modelValue', 0.4);
			await nextTick();
			expect(itemOf(emittedGraphics(wrapper, 1))).toMatchObject({ color: '#ffcc00', opacity: 0.4 });

			expect(wrapper.find('[data-testid="graphic-item-visible"]').exists()).toBe(true);
			expect(wrapper.find('[data-testid="graphic-item-rotation"]').exists()).toBe(true);
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

			expect(findControl(wrapper, 'USelect', 'data-testid', 'graphic-input-type')).toBeUndefined();
			expect(wrapper.findAll('[data-testid="graphic-input-add"]')).toHaveLength(0);
		});

		it('keeps them for a host whose compositions declare their own', async () => {
			const wrapper = await mountComponent({
				graphics: stack([]),
				selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			});

			expect(findControl(wrapper, 'USelect', 'data-testid', 'graphic-input-type')).toBeDefined();
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
				.find(button => button.attributes('data-host-token') === 'player1Name')!
				.vm
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
				.find(button => button.attributes('data-host-token') === 'player1Name')!
				.vm
				.$emit('click');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
		});

		it('styles a host token placeholder that no Graphic Input declares', async () => {
			// The styleable set follows whichever side supplies the keys. Asking the
			// graphic's own declarations would leave every Feature Match placeholder
			// unstyleable, because a Feature Match Overlay declares none.
			const wrapper = await mountComponent({
				graphics: stack([
					{ ...textItem, text: 'Hi {player1Name}' } as GraphicItemConfig,
				]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			expect(wrapper.findAll('[data-graphic-placeholder-style]').map(node =>
				node.attributes('data-graphic-placeholder-style'),
			)).toEqual(['player1Name']);
		});

		it('styles a player name independently from the player record', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					{
						...textItem,
						text: '{player1Name}\n{player1Record}',
					} as GraphicItemConfig,
				]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});
			const styleOf = (inputKey: string) => wrapper.findAllComponents({ name: 'USelect' }).find(select =>
				select.attributes('data-testid') === 'graphic-placeholder-style-font-style'
				&& select.element.closest(`[data-graphic-placeholder-style="${inputKey}"]`) !== null);
			const nameStyle = styleOf('player1Name');
			const recordStyle = styleOf('player1Record');

			expect(nameStyle?.attributes('value')).toBe('base');
			expect(recordStyle?.attributes('value')).toBe('base');
			nameStyle!.vm.$emit('update:modelValue', 'italic');
			await nextTick();

			const styled = itemOf(emittedGraphics(wrapper));
			expect(styled?.type === 'text'
				? styled.placeholderStyles
				: undefined).toEqual({
				player1Name: { fontStyle: 'italic' },
			});
		});

		it('offers no Graphic Placeholder Style for a key this host does not supply', async () => {
			// `{name}` is a legacy Feature Match token, and the shared catalogue moved the
			// side into the key. Nothing resolves it, so styling it would style something
			// that renders nothing.
			const wrapper = await mountComponent({
				graphics: stack([
					{ ...textItem, text: 'Hi {name}' } as GraphicItemConfig,
				]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			expect(wrapper.findAll('[data-graphic-placeholder-style]')).toHaveLength(0);
		});
	});

	// A Graphic Input is named and keyed separately, and only the key resolves.
	describe('placeholders a Graphic Text Template names', () => {
		function namedInput(key: string, label: string): GraphicInputDeclaration {
			return {
				...textInput(key),
				label,
			};
		}

		function unresolvedNotice(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.find('[data-testid="unresolved-placeholders"]');
		}

		it('names a placeholder nothing declares, and the keys that would have worked', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					{ ...textItem, text: 'Hi {leftName}' } as GraphicItemConfig,
				])
					.map(graphic => ({
						...graphic,
						inputs: [
							namedInput('input-1', 'leftName'),
						],
					})),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			const notice = unresolvedNotice(wrapper);
			expect(notice.text()).toContain('{leftName}');
			expect(notice.text()).toContain('{input-1}');
		});

		it('says so plainly when the composition has declared nothing at all', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					{ ...textItem, text: 'Hi {leftName}' } as GraphicItemConfig,
				]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(unresolvedNotice(wrapper).text()).toContain('declares no Graphic Inputs yet');
		});

		it('stays silent while every placeholder resolves', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					{ ...textItem, text: 'Hi {input-1}' } as GraphicItemConfig,
				])
					.map(graphic => ({
						...graphic,
						inputs: [
							namedInput('input-1', 'leftName'),
						],
					})),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(unresolvedNotice(wrapper).exists()).toBe(false);
		});

		it('offers the declared Graphic Input keys to append, beside the names they answer to', async () => {
			// Without this the key had no representation anywhere the author was
			// looking while editing the text, and had to be retyped from memory.
			const wrapper = await mountComponent({
				graphics: stack([textItem])
					.map(graphic => ({
						...graphic,
						inputs: [
							namedInput('input-1', 'leftName'),
						],
					})),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			const offered = wrapper.findAllComponents(UButtonStub)
				.filter(button => button.attributes('data-host-token') !== undefined);
			expect(offered.map(button => button.attributes('data-host-token'))).toEqual(['input-1']);
			expect(offered[0]!.text()).toContain('{input-1}');
			expect(offered[0]!.text()).toContain('leftName');

			offered[0]!.vm.$emit('click');
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ text: 'Commentator{input-1}' });
		});

		it('offers each projection read-only value separately from editable Graphic Inputs', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					groupWith([textItem], { id: 'profile-group' }),
				]).map(graphic => ({
					...graphic,
					inputs: [
						namedInput('title', 'Title'),
					],
					socialProfileProjections: [
						{
							key: 'talent-profile',
							label: 'Talent profile',
							sourceKey: 'talent',
							presentationGroupId: 'profile-group',
							dwellMs: 8_000,
							transition: 'crossfade',
							transitionDurationMs: 250,
						},
					],
				})),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			const offered = wrapper.findAllComponents(UButtonStub)
				.filter(button => button.attributes('data-host-token') !== undefined);
			expect(offered.map(button => button.attributes('data-host-token'))).toEqual([
				'title',
				'talent-profile.networkLabel',
				'talent-profile.handle',
				'talent-profile.profileUrl',
			]);
			expect(offered[1]!.text()).toContain('Projected network label');
		});
	});

	it('declares a typed Graphic Input on the selected Broadcast Graphic', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		selectField(wrapper, 'graphic-input-type').vm.$emit('update:modelValue', 'number');
		await nextTick();
		wrapper.findAllComponents(UButtonStub)
			.find(button => button.attributes('data-testid') === 'graphic-input-add')!
			.vm
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
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					textInput('name'),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		switchField(wrapper, 'graphic-input-required').vm.$emit('update:modelValue', true);
		selectField(wrapper, 'graphic-input-policy').vm.$emit('update:modelValue', 'live');
		await nextTick();

		expect(emittedGraphics(wrapper, 0)[0]!.inputs![0]).toMatchObject({ key: 'name', required: true });
		expect(emittedGraphics(wrapper, 1)[0]!.inputs![0]).toMatchObject({ key: 'name', updatePolicy: 'live' });
	});

	// A choice Graphic Input had an Options field and no Default control, so it was stuck at
	// `default: null` however its author declared it (#336, carried out of #60 story 13).
	it('sets a choice Graphic Input’s default from its own declared options, and offers no other value', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					choiceInput('side', [
						{ value: 'l', label: 'Left' },
						{ value: 'r', label: 'Right' },
					]),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		// Its own options and a way back to no default — nothing else is offered, which
		// is what keeps the default inside the options.
		expect(selectField(wrapper, 'graphic-input-default').props('items')).toEqual([
			{ label: 'No default', value: '' },
			{ label: 'Left', value: 'l' },
			{ label: 'Right', value: 'r' },
		]);

		selectField(wrapper, 'graphic-input-default').vm.$emit('update:modelValue', 'r');
		await nextTick();

		expect(declarationOf(wrapper)).toMatchObject({ type: 'choice', default: 'r' });
	});

	it('takes a choice Graphic Input back to no default', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					choiceInput('side', [
						{ value: 'l', label: 'Left' },
					], 'l'),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		expect(selectField(wrapper, 'graphic-input-default').props('modelValue')).toBe('l');

		selectField(wrapper, 'graphic-input-default').vm.$emit('update:modelValue', '');
		await nextTick();

		expect(declarationOf(wrapper)).toMatchObject({ default: null });
	});

	it('shows a choice Graphic Input with no declared default as its No default option', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					choiceInput('side', [
						{ value: 'l', label: 'Left' },
					]),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		// A null default is not a value the select can carry, so the panel maps it onto the No
		// default option it offers.
		expect(selectField(wrapper, 'graphic-input-default').props('modelValue')).toBe('');
	});

	it('drops a choice Graphic Input’s default when its author edits that option away', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					choiceInput('side', [
						{ value: 'l', label: 'Left' },
						{ value: 'r', label: 'Right' },
					], 'r'),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		wrapper.findAllComponents(UInputStub)
			.find(input => input.attributes('data-testid') === 'graphic-input-options')!
			.vm
			.$emit('update:modelValue', 'l=Left');
		await nextTick();

		// A default outside its options is a value the input reports unavailable, so the
		// graphic would start on something it can never show.
		expect(declarationOf(wrapper)).toMatchObject({
			options: [
				{ value: 'l', label: 'Left' },
			],
			default: null,
		});
	});

	// Nothing anywhere set a media Graphic Input DECLARATION's kind before #336 — the writes around
	// it were all for the Media Graphic Item, whose kind comes from its chosen asset — so a silent-…
	it('declares which media a media Graphic Input accepts', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					mediaInput('sting'),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		expect(selectField(wrapper, 'graphic-input-media-kind').props('items')).toEqual([
			{ label: 'Image', value: 'image' },
			{ label: 'Silent video', value: 'silent-video' },
		]);

		selectField(wrapper, 'graphic-input-media-kind').vm.$emit('update:modelValue', 'silent-video');
		await nextTick();

		expect(declarationOf(wrapper)).toMatchObject({ type: 'media', mediaKind: 'silent-video' });
	});

	// The declared kind is the only kind Live Control's picker then offers, which is pinned on that
	// component; here it is the kind this panel's own default picker is restricted to, so an author…
	it('restricts a media Graphic Input’s default to the kind it declares', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					mediaInput('sting', { mediaKind: 'silent-video' }),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		expect(wrapper.getComponent(GraphicsAssetFocusPickerStub).props('assetKind')).toBe('silent-video');
	});

	it('names this panel’s default picker as its own, not as the item picker', async () => {
		// Two panels mount the same picker and a test that finds "the" picker by testid
		// has to be able to tell them apart. The name is the panel's, passed at the call
		// site; the stub's `media-asset-picker` fallback is for the item panel, which
		// passes none — so it must not appear here, where a name was passed.
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					mediaInput('sting', { mediaKind: 'silent-video' }),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		expect(wrapper.find('[data-testid="graphic-input-default"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="media-asset-picker"]').exists()).toBe(false);
	});

	it('shows a media Graphic Input’s declared default as the reference it pins', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					mediaInput('sting', {
						default: { assetId: 'asset-1' as never, revisionId: 'revision-1' as never },
					}),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		// The picker is what reports a Missing or Unavailable Graphic Asset Reference,
		// and it can only report against the reference it is handed — a panel that
		// stopped handing it over would show a pinned default as no default at all.
		expect(wrapper.getComponent(GraphicsAssetFocusPickerStub).props('modelValue'))
			.toEqual({ assetId: 'asset-1', revisionId: 'revision-1' });
	});

	it('pins a media Graphic Input’s default revision as exactly that revision', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					mediaInput('sting', { mediaKind: 'silent-video' }),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		wrapper.getComponent(GraphicsAssetFocusPickerStub).vm.$emit(
			'select',
			{
				id: 'asset-2',
				kind: 'silent-video',
				facts: { kind: 'silent-video', targetCompatibility: 'chromium-transparency' },
			},
			{ assetId: 'asset-2', revisionId: 'revision-3' },
		);
		await nextTick();

		expect(declarationOf(wrapper)).toMatchObject({
			default: { assetId: 'asset-2', revisionId: 'revision-3' },
		});
		expect((declarationOf(wrapper) as { default?: object }).default).not.toHaveProperty('videoCompatibility');
	});

	it('unpins a media Graphic Input’s default when the picker clears it', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					mediaInput('sting', {
						default: { assetId: 'asset-1' as never, revisionId: 'revision-1' as never },
					}),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		wrapper.getComponent(GraphicsAssetFocusPickerStub).vm.$emit('update:modelValue', undefined);
		await nextTick();

		expect(declarationOf(wrapper)).toMatchObject({ default: null });
	});

	it('writes nothing when an author clears a Graphic Input’s label', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					textInput('name'),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		wrapper.findAllComponents(UInputStub)
			.find(input => input.attributes('data-testid') === 'graphic-input-label')!
			.vm
			.$emit('update:modelValue', '');
		await nextTick();

		// A nameless Graphic Input is one the write path refuses, so a cleared field
		// leaves the Screen's mode configuration alone rather than writing it unchanged.
		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});

	it('shows the stable key a Graphic Text Template would name, and offers no way to edit it', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					textInput('name'),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		expect(wrapper.get('[data-testid="graphic-input-key"]').text()).toBe('{name}');
		expect(wrapper.get('[data-testid="graphic-input-key"]').element.tagName).toBe('P');
	});

	it('offers a Graphic Placeholder Style for each declared input its template names', async () => {
		const wrapper = await mountComponent({
			graphics: [
				{
					id: 'lower-third',
					name: 'Lower Third',
					inputs: [
						textInput('name'),
					],
					items: [
						{ ...textItem, text: '{name} — {undeclared}' },
					],
				},
			],
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.findAll('[data-graphic-placeholder-style]').map(entry =>
			entry.attributes('data-graphic-placeholder-style'),
		)).toEqual(['name']);
	});

	it('overrides one placeholder’s typography and returns it to the item’s base', async () => {
		const wrapper = await mountComponent({
			graphics: [
				{
					id: 'lower-third',
					name: 'Lower Third',
					inputs: [
						textInput('name'),
					],
					items: [
						{
							...textItem,
							text: '{name}',
							placeholderStyles: {
								name: { fontWeight: 300 },
							},
						},
					],
				},
			],
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		numberFieldByTestId(wrapper, 'graphic-placeholder-style-size').vm.$emit('update:modelValue', 24);
		await nextTick();
		wrapper.findAllComponents(UButtonStub)
			.find(button => button.attributes('data-testid') === 'graphic-placeholder-style-clear')!
			.vm
			.$emit('click');
		await nextTick();

		const styled = itemOf(emittedGraphics(wrapper, 0));
		expect(styled?.type === 'text'
			? styled.placeholderStyles
			: undefined)
			.toEqual({
				name: { fontWeight: 300, fontSize: 24 },
			});

		const cleared = itemOf(emittedGraphics(wrapper, 1));
		expect(cleared?.type === 'text'
			? cleared.placeholderStyles
			: undefined).toBeUndefined();
	});

	it('sets one placeholder’s case and letter spacing, and offers it no line height', async () => {
		const wrapper = await mountComponent({
			graphics: [
				{
					id: 'lower-third',
					name: 'Lower Third',
					inputs: [
						textInput('name'),
					],
					items: [
						{
							...textItem,
							text: '{name}',
							placeholderStyles: {
								name: { fontWeight: 300 },
							},
						},
					],
				},
			],
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});
		const placeholder = wrapper.find('[data-graphic-placeholder-style="name"]');

		expect(selectField(wrapper, 'graphic-placeholder-style-case').attributes('value')).toBe('base');
		expect(placeholder.find('[data-testid="graphic-placeholder-style-line-height"]').exists()).toBe(false);
		selectField(wrapper, 'graphic-placeholder-style-case').vm.$emit('update:modelValue', 'uppercase');
		await nextTick();
		numberFieldByTestId(wrapper, 'graphic-placeholder-style-letter-spacing').vm.$emit('update:modelValue', 4);
		await nextTick();
		numberFieldByTestId(wrapper, 'graphic-placeholder-style-weight').vm.$emit('update:modelValue', null);
		await nextTick();

		const cased = itemOf(emittedGraphics(wrapper, 0));
		expect(cased?.type === 'text'
			? cased.placeholderStyles
			: undefined)
			.toEqual({
				name: { fontWeight: 300, textTransform: 'uppercase' },
			});
		const spaced = itemOf(emittedGraphics(wrapper, 1));
		expect(spaced?.type === 'text'
			? spaced.placeholderStyles
			: undefined)
			.toEqual({
				name: { fontWeight: 300, letterSpacing: 4 },
			});
		// A cleared weight is the item's base weight again, and nothing else was set.
		const cleared = itemOf(emittedGraphics(wrapper, 2));
		expect(cleared?.type === 'text'
			? cleared.placeholderStyles
			: undefined).toBeUndefined();
	});

	// A Text Graphic Item's base Graphic Font Selection.
	describe('a base typography font', () => {
		function typographyFontPicker(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.findAllComponents({ name: 'GraphicsAssetFocusPicker' })
				.find(picker => picker.attributes('data-field-label') === 'Typography');
		}

		function typographyOf(graphics: BroadcastGraphicConfig[]) {
			const item = itemOf(graphics);
			return item?.type === 'text'
				? item.typography
				: undefined;
		}

		// Two answers, not three (#167).
		it('offers only the two answers a Text Graphic Item’s own typography has', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(selectField(wrapper, 'typography-font-source').props('items')).toEqual([
				{ label: 'Application font', value: 'application' },
				{ label: 'Library font', value: 'asset' },
			]);
			// With no third answer the control is the source, and its application arm is
			// simply the font — the labelling a placeholder cannot use.
			expect(wrapper.find('[data-label="Font source"] [data-testid="typography-font-source"]').exists()).toBe(true);
			expect(wrapper.find('[data-label="Font"] [data-testid="typography-font"]').exists()).toBe(true);
		});

		// The answer this control is not offered, refused rather than cast away (#199).
		it('refuses “same as base”, which its font control cannot render', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'typography-font-source').vm.$emit('update:modelValue', 'base');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
			expect(wrapper.find('[data-label="Font"] [data-testid="typography-font"]').exists()).toBe(true);
		});

		/** The asset arm needs an exact revision, so nothing is written until one is pinned. */
		it('writes no library font until the picker has pinned a revision', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'typography-font-source').vm.$emit('update:modelValue', 'asset');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
			expect(typographyFontPicker(wrapper)?.exists()).toBe(true);
		});

		// The application arm writes what the author picked.
		it('chooses an application font for the item', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'typography-font').vm.$emit('update:modelValue', 'saira-condensed');
			await nextTick();

			expect(typographyOf(emittedGraphics(wrapper, 0))?.font)
				.toEqual({ kind: 'application', fontId: 'saira-condensed' });
		});

		it('pins one exact font Graphic Asset Revision on the item', async () => {
			const wrapper = await mountComponent({
				graphics: stack([textItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'typography-font-source').vm.$emit('update:modelValue', 'asset');
			await nextTick();
			typographyFontPicker(wrapper)!.vm.$emit(
				'select',
				{ id: 'font-1', kind: 'font' },
				{ assetId: 'font-1', revisionId: 'font-revision-2' },
			);
			await nextTick();

			expect(typographyOf(emittedGraphics(wrapper, 0))?.font)
				.toEqual({
					kind: 'asset',
					reference: { assetId: 'font-1', revisionId: 'font-revision-2' },
				});
		});

		// A `GraphicTypography` must name a font, so leaving the library arm cannot leave the item
		// on none.
		it('returns to an application font rather than to none', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					{
						...textItem,
						typography: {
							...DEFAULT_GRAPHIC_TYPOGRAPHY,
							font: {
								kind: 'asset',
								reference: { assetId: 'font-1', revisionId: 'font-revision-2' },
							},
						},
					} as GraphicItemConfig,
				]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(typographyFontPicker(wrapper)?.attributes('data-asset-id')).toBe('font-1');

			selectField(wrapper, 'typography-font-source').vm.$emit('update:modelValue', 'application');
			await nextTick();

			expect(typographyOf(emittedGraphics(wrapper, 0))?.font)
				.toEqual({ kind: 'application', fontId: 'inter' });
		});

		// The same fallback, reached from the picker rather than from the arm.
		it('returns to an application font when the picker unpins the revision', async () => {
			const wrapper = await mountComponent({
				graphics: stack([
					{
						...textItem,
						typography: {
							...DEFAULT_GRAPHIC_TYPOGRAPHY,
							font: {
								kind: 'asset',
								reference: { assetId: 'font-1', revisionId: 'font-revision-2' },
							},
						},
					} as GraphicItemConfig,
				]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			typographyFontPicker(wrapper)!.vm.$emit('update:modelValue', undefined);
			await nextTick();

			expect(typographyOf(emittedGraphics(wrapper, 0))?.font)
				.toEqual({ kind: 'application', fontId: 'inter' });
		});
	});

	// A Graphic Placeholder Style's own Graphic Font Selection (#161).
	describe('a Graphic Placeholder Style font', () => {
		function placeholderTextGraphic(
			placeholderStyles?: Record<string, Record<string, unknown>>,
		): BroadcastGraphicConfig[] {
			return [
				{
					id: 'lower-third',
					name: 'Lower Third',
					inputs: [
						textInput('name'),
					],
					items: [
						{
							...textItem,
							text: '{name}',
							...(placeholderStyles
								? { placeholderStyles }
								: {}),
						} as GraphicItemConfig,
					],
				},
			];
		}

		function placeholderFontPicker(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.findAllComponents({ name: 'GraphicsAssetFocusPicker' })
				.find(picker => picker.attributes('data-field-label') === 'Placeholder {name}');
		}

		function placeholderStylesOf(graphics: BroadcastGraphicConfig[]) {
			const item = itemOf(graphics);
			return item?.type === 'text'
				? item.placeholderStyles
				: undefined;
		}

		// Three answers, not two (#167).
		it('offers a placeholder the third answer its optional font has', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: { fontWeight: 300 },
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(selectField(wrapper, 'graphic-placeholder-style-font-source').props('items')).toEqual([
				{ label: 'Same as base', value: 'base' },
				{ label: 'Application font', value: 'application' },
				{ label: 'Library font', value: 'asset' },
			]);
			// And with a third answer the control itself is the font, so its application arm
			// has to name itself to be told apart from "Same as base".
			expect(wrapper.find('[data-label="Font"] [data-testid="graphic-placeholder-style-font-source"]').exists())
				.toBe(true);

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				.vm
				.$emit('update:modelValue', 'application');
			await nextTick();

			expect(wrapper.find('[data-label="Application font"] [data-testid="graphic-placeholder-style-font"]').exists())
				.toBe(true);
		});

		it('chooses an application font for one placeholder', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: { fontWeight: 300 },
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				.vm
				.$emit('update:modelValue', 'application');
			await nextTick();
			selectField(wrapper, 'graphic-placeholder-style-font')
				.vm
				.$emit('update:modelValue', 'saira-condensed');
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 1)))
				.toEqual({
					name: {
						fontWeight: 300,
						font: { kind: 'application', fontId: 'saira-condensed' },
					},
				});
		});

		// The control refuses what the write path refuses, per #119.
		it('writes no library font until the picker has pinned a revision', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic(),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				.vm
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
				.vm
				.$emit('update:modelValue', 'asset');
			await nextTick();
			placeholderFontPicker(wrapper)!.vm.$emit(
				'select',
				{ id: 'font-1', kind: 'font' },
				{ assetId: 'font-1', revisionId: 'font-revision-2' },
			);
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 0))).toEqual({
				name: {
					font: {
						kind: 'asset',
						reference: { assetId: 'font-1', revisionId: 'font-revision-2' },
					},
				},
			});
		});

		// Returning to the base typography removes the key rather than storing a font of nothing.
		it('returns one placeholder to the item’s base font', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: {
						fontWeight: 300,
						font: {
							kind: 'asset',
							reference: { assetId: 'font-1', revisionId: 'font-revision-2' },
						},
					},
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			// The stored style already says which arm it is on, so the picker is offered
			// without the author having to choose the arm first.
			expect(placeholderFontPicker(wrapper)?.attributes('data-asset-id')).toBe('font-1');

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				.vm
				.$emit('update:modelValue', 'base');
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 0))).toEqual({
				name: { fontWeight: 300 },
			});
		});

		/** A placeholder that has chosen no font of its own says so, and offers no picker. */
		it('starts every placeholder on the item’s base font', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: { fontWeight: 300 },
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			expect(selectField(wrapper, 'graphic-placeholder-style-font-source').props('modelValue'))
				.toBe('base');
			expect(findControl(wrapper, 'USelect', 'data-testid', 'graphic-placeholder-style-font')).toBeUndefined();
			expect(placeholderFontPicker(wrapper)).toBeUndefined();
		});

		// Unpinning a library font leaves the placeholder on the base typography rather than on a
		// font the author never chose — the base typography control has to fall back to an…
		it('unpins a library font without inventing one in its place', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: {
						fontWeight: 300,
						font: {
							kind: 'asset',
							reference: { assetId: 'font-1', revisionId: 'font-revision-2' },
						},
					},
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			placeholderFontPicker(wrapper)!.vm.$emit('update:modelValue', undefined);
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 0))).toEqual({
				name: { fontWeight: 300 },
			});
			expect(selectField(wrapper, 'graphic-placeholder-style-font-source').props('modelValue'))
				.toBe('asset');
		});

		// The arm an author has chosen but not yet stored belongs to the placeholder they chose it
		// on.
		it('forgets an unstored arm when the selection moves', async () => {
			const second = {
				...textItem,
				id: 'subhead',
				label: 'Text 2',
				text: '{name}',
			} as GraphicItemConfig;
			const wrapper = await mountComponent({
				graphics: [
					{
						id: 'lower-third',
						name: 'Lower Third',
						inputs: [
							textInput('name'),
						],
						items: [
							{ ...textItem, text: '{name}' } as GraphicItemConfig,
							second,
						],
					},
				],
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				.vm
				.$emit('update:modelValue', 'asset');
			await nextTick();
			expect(placeholderFontPicker(wrapper)?.exists()).toBe(true);

			await wrapper.setProps({
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'subhead' },
			});
			await nextTick();

			expect(selectField(wrapper, 'graphic-placeholder-style-font-source').props('modelValue'))
				.toBe('base');
			expect(placeholderFontPicker(wrapper)).toBeUndefined();
		});

		/** An emptied Graphic Placeholder Style is the absence of one, not an empty one. */
		it('drops a Graphic Placeholder Style whose last property it removes', async () => {
			const wrapper = await mountComponent({
				graphics: placeholderTextGraphic({
					name: {
						font: { kind: 'application', fontId: 'inter' },
					},
				}),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			});

			selectField(wrapper, 'graphic-placeholder-style-font-source')
				.vm
				.$emit('update:modelValue', 'base');
			await nextTick();

			expect(placeholderStylesOf(emittedGraphics(wrapper, 0))).toBeUndefined();
		});
	});

	// Where the Event Data authoring surface is allowed to appear.
	it('authors Graphic Source Selections beside the Graphic Inputs they feed', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				inputs: [
					textInput('name'),
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		expect(wrapper.find('[data-testid="graphic-event-data-bindings"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphic-source-add"]').exists()).toBe(true);
	});

	it('authors Social Profile Projections in a surface distinct from Graphic Inputs and sources', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]).map(graphic => ({
				...graphic,
				sources: [
					{ key: 'talent', label: 'Talent', kind: 'talent' },
				],
			})),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		const projectionSurface = wrapper.get('[data-testid="social-profile-projections"]');
		expect(projectionSurface.text()).toContain('Social Profile Projections');
		expect(projectionSurface.find('[data-testid="graphic-input-add"]').exists()).toBe(false);
		expect(projectionSurface.find('[data-testid="graphic-source-add"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-event-data-bindings"]').exists()).toBe(true);
	});

	it('withholds them from a host that binds host tokens', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
		});

		expect(wrapper.find('[data-testid="graphic-event-data-bindings"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="social-profile-projections"]').exists()).toBe(false);
	});

	it('refuses a read-only observer’s Graphic Input declaration', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			writable: false,
		});

		wrapper.findAllComponents(UButtonStub)
			.find(button => button.attributes('data-testid') === 'graphic-input-add')!
			.vm
			.$emit('click');
		await nextTick();

		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});
	describe('the context-gated Feature Match Definitions', () => {
		// A Feature Match Layout holding one item of a context-gated kind.
		function featureMatchStack(kind: 'clock' | 'player-life' | 'game-wins' | 'deck-list') {
			return stack([
				getGraphicItemDefinition(kind).createDefault({
					id: kind,
					label: kind,
					canvasWidth: 1920,
					canvasHeight: 1080,
				}),
			]);
		}

		function mountKind(kind: 'clock' | 'player-life' | 'game-wins' | 'deck-list', graphics = featureMatchStack(kind)) {
			return mountComponent({
				graphics,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: kind },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});
		}

		it('sets a Deck List Item’s view and quantity gate', async () => {
			const wrapper = await mountKind('deck-list');

			selectField(wrapper, 'deck-list-view').vm.$emit('update:modelValue', 'grid');
			await nextTick();
			await switchField(wrapper, 'deck-list-show-quantities').trigger('click');

			expect(itemOf(emittedGraphics(wrapper, 0))).toMatchObject({ type: 'deck-list', view: 'grid' });
			expect(itemOf(emittedGraphics(wrapper, 1))).toMatchObject({ showQuantities: false });
		});

		it('sets the life-change animation a Player Life Item marks a change with', async () => {
			const wrapper = await mountKind('player-life');

			selectField(wrapper, 'player-life-animation').vm.$emit('update:modelValue', 'pop');
			await nextTick();
			numberFieldByTestId(wrapper, 'player-life-animation-duration').vm.$emit('update:modelValue', 800);
			await nextTick();
			// The colour a glow or slide change tints; the other animations ignore it.
			wrapper.findAllComponents(UInputStub)
				.find(input => input.attributes('data-testid') === 'player-life-animation-accent')!
				.vm
				.$emit('update:modelValue', '#ff0055');
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper, 0))).toMatchObject({ lifeAnimation: 'pop' });
			expect(itemOf(emittedGraphics(wrapper, 1))).toMatchObject({ lifeAnimationDurationMs: 800 });
			expect(itemOf(emittedGraphics(wrapper, 2))).toMatchObject({ lifeAnimationAccentColor: '#ff0055' });
		});

		it('sets a Game Wins Item’s win box orientation, dimensions, and gap', async () => {
			const wrapper = await mountKind('game-wins');

			selectField(wrapper, 'game-wins-box-orientation').vm.$emit('update:modelValue', 'vertical');
			await nextTick();
			numberField(wrapper, 'Win box width').vm.$emit('update:modelValue', 40);
			await nextTick();
			numberField(wrapper, 'Win box height').vm.$emit('update:modelValue', 12);
			await nextTick();
			numberField(wrapper, 'Win box gap').vm.$emit('update:modelValue', 3);
			await nextTick();

			expect(itemOf(emittedGraphics(wrapper, 0))).toMatchObject({ boxOrientation: 'vertical' });
			expect(itemOf(emittedGraphics(wrapper, 1))).toMatchObject({ boxWidth: 40 });
			expect(itemOf(emittedGraphics(wrapper, 2))).toMatchObject({ boxHeight: 12 });
			expect(itemOf(emittedGraphics(wrapper, 3))).toMatchObject({ boxGap: 3 });
		});

		it('offers a Game Wins Item its box layout only while it renders boxes', async () => {
			// The `number` display mode paints a win count: there is no box to orient or
			// size, and the authored values survive the switch. Its box surfaces and box
			// geometry are covered over every Definition below.
			const boxes = await mountKind('game-wins');
			expect(boxes.find('[data-testid="game-wins-box-orientation"]').exists()).toBe(true);

			selectField(boxes, 'game-wins-display-mode').vm.$emit('update:modelValue', 'number');
			await nextTick();

			const number = await mountKind('game-wins', emittedGraphics(boxes));
			expect(number.find('[data-testid="game-wins-box-orientation"]').exists()).toBe(false);
		});

		it('paints a Game Wins Item’s unwon and won boxes independently', async () => {
			// An unwon box reads as an empty outline and a won one as a filled pip, which
			// is the distinction the indicator exists to make.
			const wrapper = await mountKind('game-wins');

			wrapper.findAllComponents(UInputStub)
				.find(input => input.attributes('data-testid') === 'game-wins-box-graphic-fill-color')!
				.vm
				.$emit('update:modelValue', '#123456');
			await nextTick();
			await switchField(wrapper, 'game-wins-won-box-graphic-glow-enabled').trigger('click');

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

			await wrapper.get('[data-testid="shape-corner-topRight"] [data-treatment-option="cut"]').trigger('click');
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
				graphics: stack([
					groupWith([clock as never]),
				]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'clock' },
				contract: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
			});

			selectField(wrapper, 'graphic-group-child-sizing-mode').vm.$emit('update:modelValue', 'fill');
			await nextTick();

			expect(childOf(emittedGraphics(wrapper))).toMatchObject({
				sizing: { mode: 'fill' },
			});
		});

		it('offers no win box or life-change control to a kind that has none', async () => {
			const wrapper = await mountComponent({
				graphics: stack([shapeItem]),
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
			});

			expect(wrapper.find('[data-testid="game-wins-display-mode"]').exists()).toBe(false);
			expect(wrapper.find('[data-testid="player-life-animation"]').exists()).toBe(false);
		});
	});
});

// Typography and the Text Overflow Policy, over every Graphic Item Definition.
/** One Graphic Item Definition as a table row places it, in one display mode. */
interface DefinitionRow {
	name: string;
	kind: GraphicItemKind;
	variant?: (item: GraphicItemConfig) => GraphicItemConfig;
}

/** A host that can supply the Definition, since the Inspector serves both. */
function contractFor(kind: GraphicItemKind): GraphicsHostContract {
	const definition = getGraphicItemDefinition(kind);
	return isGraphicItemDefinitionAvailable(definition, BROADCAST_GRAPHICS_HOST_CONTRACT)
		? BROADCAST_GRAPHICS_HOST_CONTRACT
		: FEATURE_MATCH_OVERLAY_HOST_CONTRACT;
}

function placedRow(row: DefinitionRow, overrides: Partial<GraphicItemConfig> = {}): GraphicItemConfig {
	const placed = getGraphicItemDefinition(row.kind).createDefault({
		id: 'item',
		label: row.name,
		canvasWidth: 1920,
		canvasHeight: 1080,
	});
	return {
		...(row.variant?.(placed) ?? placed),
		...overrides,
	} as GraphicItemConfig;
}

function mountDefinition(row: DefinitionRow, overrides: Partial<GraphicItemConfig> = {}) {
	return mountComponent({
		graphics: stack([
			placedRow(row, overrides),
		]),
		selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'item' },
		contract: contractFor(row.kind),
	});
}

describe('typography and the Text Overflow Policy for every Graphic Item Definition', () => {
	interface Row extends DefinitionRow {
		typography: boolean;
		textOverflowPolicy: boolean;
	}

	const ROWS: Row[] = [
		{
			name: 'text',
			kind: 'text',
			typography: true,
			textOverflowPolicy: true,
		},
		{
			name: 'shape',
			kind: 'shape',
			typography: false,
			textOverflowPolicy: false,
		},
		{
			name: 'media',
			kind: 'media',
			typography: false,
			textOverflowPolicy: false,
		},
		{
			name: 'social-network-icon',
			kind: 'social-network-icon',
			typography: false,
			textOverflowPolicy: false,
		},
		{
			name: 'group',
			kind: 'group',
			typography: false,
			textOverflowPolicy: false,
		},
		{
			name: 'clock',
			kind: 'clock',
			typography: true,
			textOverflowPolicy: true,
		},
		{
			name: 'player-life',
			kind: 'player-life',
			typography: true,
			textOverflowPolicy: true,
		},
		{
			name: 'game-wins as boxes',
			kind: 'game-wins',
			typography: false,
			textOverflowPolicy: false,
		},
		{
			name: 'game-wins as a number',
			kind: 'game-wins',
			variant: item => ({ ...item, displayMode: 'number' }) as GraphicItemConfig,
			typography: true,
			textOverflowPolicy: false,
		},
		{
			name: 'deck-list as a list',
			kind: 'deck-list',
			typography: true,
			textOverflowPolicy: false,
		},
		{
			name: 'deck-list as a grid',
			kind: 'deck-list',
			variant: item => ({ ...item, view: 'grid' }) as GraphicItemConfig,
			typography: false,
			textOverflowPolicy: false,
		},
	];

	function mountRow(row: Row, overrides: Partial<GraphicItemConfig> = {}) {
		return mountDefinition(row, overrides);
	}

	it('covers every Definition', () => {
		expect([
			...new Set(ROWS.map(row => row.kind)),
		].sort()).toEqual([...GRAPHIC_ITEM_KINDS].sort());
	});

	it.each(ROWS)('offers $name exactly the typography it paints with', async (row) => {
		const wrapper = await mountRow(row);
		const fontSize = findControl(wrapper, 'UInputNumber', 'aria-label', 'Font size');

		expect(fontSize !== undefined).toBe(row.typography);
		if (!fontSize)
			return;

		fontSize.vm.$emit('update:modelValue', 96);
		await nextTick();
		const patched = itemOf(emittedGraphics(wrapper));
		expect(patched && 'typography' in patched && patched.typography.fontSize).toBe(96);
	});

	it.each(ROWS)('bounds $name with a Text Overflow Policy only where its text can outgrow its bounds', async (row) => {
		const wrapper = await mountRow(row);
		const policy = findControl(wrapper, 'USelect', 'data-testid', 'text-overflow-policy');

		expect(policy !== undefined).toBe(row.textOverflowPolicy);
		if (!policy)
			return;

		policy.vm.$emit('update:modelValue', 'shrink');
		await nextTick();
		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ overflowPolicy: 'shrink' });

		// The floor a shrink policy stops at appears once shrinking is what happens.
		const shrinking = await mountRow(row, { overflowPolicy: 'shrink' } as Partial<GraphicItemConfig>);
		numberFieldByTestId(shrinking, 'text-min-font-size').vm.$emit('update:modelValue', 30);
		await nextTick();
		expect(itemOf(emittedGraphics(shrinking))).toMatchObject({ minFontSize: 30 });
	});
});

// Graphic Surface Styles, the Shape Geometry, and the Player, over every Graphic Item Definition.
describe('surfaces, Shape Geometry, and the Player for every Graphic Item Definition', () => {
	type BoxSurfaceSlot = 'boxSurfaceStyle' | 'wonBoxSurfaceStyle';

	interface Row extends DefinitionRow {
		ownSurface: boolean;
		boxSurfaces: BoxSurfaceSlot[];
		geometry: { slot: 'geometry' | 'clipGeometry' | 'boxGeometry'; title: string } | null;
		playerSide: boolean;
	}

	const SHAPE = 'Shape Geometry';
	const WIN_BOX = 'Win box Shape Geometry';

	const ROWS: Row[] = [
		{
			name: 'text',
			kind: 'text',
			ownSurface: true,
			boxSurfaces: [],
			geometry: null,
			playerSide: false,
		},
		{
			name: 'shape',
			kind: 'shape',
			ownSurface: true,
			boxSurfaces: [],
			geometry: { slot: 'geometry', title: SHAPE },
			playerSide: false,
		},
		{
			name: 'media, unclipped',
			kind: 'media',
			ownSurface: false,
			boxSurfaces: [],
			geometry: null,
			playerSide: false,
		},
		{
			name: 'media, clipped',
			kind: 'media',
			variant: item => ({
				...item,
				clipGeometry: squareShapeGeometry(),
			}) as GraphicItemConfig,
			ownSurface: false,
			boxSurfaces: [],
			geometry: { slot: 'clipGeometry', title: SHAPE },
			playerSide: false,
		},
		{
			name: 'social-network-icon',
			kind: 'social-network-icon',
			ownSurface: false,
			boxSurfaces: [],
			geometry: null,
			playerSide: false,
		},
		{
			name: 'group',
			kind: 'group',
			ownSurface: true,
			boxSurfaces: [],
			geometry: { slot: 'geometry', title: SHAPE },
			playerSide: false,
		},
		{
			name: 'clock',
			kind: 'clock',
			ownSurface: true,
			boxSurfaces: [],
			geometry: null,
			playerSide: false,
		},
		{
			name: 'player-life',
			kind: 'player-life',
			ownSurface: true,
			boxSurfaces: [],
			geometry: null,
			playerSide: true,
		},
		{
			name: 'game-wins as boxes',
			kind: 'game-wins',
			ownSurface: true,
			boxSurfaces: ['boxSurfaceStyle', 'wonBoxSurfaceStyle'],
			geometry: { slot: 'boxGeometry', title: WIN_BOX },
			playerSide: true,
		},
		{
			name: 'game-wins as a number',
			kind: 'game-wins',
			variant: item => ({ ...item, displayMode: 'number' }) as GraphicItemConfig,
			ownSurface: true,
			boxSurfaces: [],
			geometry: null,
			playerSide: true,
		},
		{
			name: 'deck-list',
			kind: 'deck-list',
			ownSurface: false,
			boxSurfaces: [],
			geometry: null,
			playerSide: true,
		},
	];

	const BOX_TEST_ID_PREFIX: Record<BoxSurfaceSlot, string> = {
		boxSurfaceStyle: 'game-wins-box',
		wonBoxSurfaceStyle: 'game-wins-won-box',
	};

	it('covers every Definition', () => {
		expect([
			...new Set(ROWS.map(row => row.kind)),
		].sort()).toEqual([...GRAPHIC_ITEM_KINDS].sort());
	});

	it.each(ROWS)('offers $name the Player only where it reads one', async (row) => {
		const wrapper = await mountDefinition(row);
		const side = findControl(wrapper, 'USelect', 'data-testid', 'graphic-item-player-side');

		expect(side !== undefined).toBe(row.playerSide);
		if (!side)
			return;

		side.vm.$emit('update:modelValue', 'player2');
		await nextTick();
		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ playerSide: 'player2' });
	});

	it.each(ROWS)('offers $name Shape Geometry controls for exactly the geometry on screen', async (row) => {
		const wrapper = await mountDefinition(row);

		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(row.geometry !== null);
		expect(wrapper.text().includes(WIN_BOX)).toBe(row.geometry?.title === WIN_BOX);
		if (!row.geometry)
			return;

		await wrapper.get('[data-testid="shape-corner-topRight"] [data-treatment-option="cut"]').trigger('click');
		await nextTick();
		const patched = itemOf(emittedGraphics(wrapper)) as unknown as Record<string, ShapeGeometry | undefined>;
		expect(patched[row.geometry.slot]?.topRight.treatment).toBe('cut');
	});

	it.each(ROWS)('offers $name a surface of its own only where it can paint one', async (row) => {
		const wrapper = await mountDefinition(row);
		const presence = findControl(wrapper, 'USwitch', 'data-testid', 'surface-style-own');

		expect(presence !== undefined).toBe(row.ownSurface);
		if (!presence) {
			// Nor any surface control beside it: an item that paints none is offered none.
			expect(wrapper.find('[data-testid="graphic-glow-enabled"]').exists()).toBe(false);
			return;
		}

		const before = placedRow(row);
		await presence.trigger('click');
		const patched = itemOf(emittedGraphics(wrapper));
		// The switch gives an item without a surface one, and takes one away again.
		expect(patched && 'surfaceStyle' in patched && patched.surfaceStyle !== undefined)
			.toBe(!('surfaceStyle' in before && before.surfaceStyle !== undefined));
	});

	it.each(ROWS)('offers $name win box surfaces only while it renders win boxes', async (row) => {
		for (const slot of ['boxSurfaceStyle', 'wonBoxSurfaceStyle'] as const) {
			const wrapper = await mountDefinition(row);
			const glow = findControl(wrapper, 'USwitch', 'data-testid', `${BOX_TEST_ID_PREFIX[slot]}-graphic-glow-enabled`);

			expect(glow !== undefined, slot).toBe(row.boxSurfaces.includes(slot));
			if (!glow)
				continue;

			await glow.trigger('click');
			const patched = itemOf(emittedGraphics(wrapper)) as unknown as Record<string, GraphicSurfaceStyle>;
			expect(patched[slot]?.glow, slot).toBeDefined();
		}
	});
});

// The Inspector's wiring to Theme bindings (#829): a bound property shows the preview Theme's value,
// and its picker binds or detaches through the editing chain.
describe('a Graphic Item property\'s Theme binding', () => {
	const SELECTED: GraphicsSelectionTarget = { type: 'item', graphicId: 'lower-third', itemId: 'name' };
	const themeTokens = resolveGraphicThemeTokens({ 'text-primary': '#123456' });

	function withText(themeBindings?: Record<string, string>): BroadcastGraphicConfig[] {
		return [
			{
				id: 'lower-third',
				name: 'Lower Third',
				items: [
					{ ...textItem, themeBindings },
				],
			},
		];
	}

	async function mountBound(themeBindings?: Record<string, string>) {
		return await mountComponent({
			graphics: withText(themeBindings),
			selectedTarget: SELECTED,
			themeTokens,
		});
	}

	it.each([
		[
			'shows the token it follows',
			{ 'typography.color': 'text-primary' },
			'text-primary',
		],
		['shows none while the property holds its own value', undefined, undefined],
	])('%s', async (_case, bindings, token) => {
		const wrapper = await mountBound(bindings);

		expect(wrapper.get('[data-testid="theme-binding-typography.color"]').attributes('data-theme-token')).toBe(token);
	});

	it('binds the property, painting the preview Theme\'s value', async () => {
		const wrapper = await mountBound();

		selectField(wrapper, 'theme-binding-typography.color-token').vm.$emit('update:modelValue', 'text-primary');
		await nextTick();

		const item = itemOf(emittedGraphics(wrapper));
		expect(item?.themeBindings).toEqual({ 'typography.color': 'text-primary' });
		expect(item?.type === 'text' && item.typography.color).toBe('#123456');
	});

	it('detaches the property, keeping the value it showed', async () => {
		const wrapper = await mountBound({ 'typography.color': 'text-primary' });

		selectField(wrapper, 'theme-binding-typography.color-token').vm.$emit('update:modelValue', '__own__');
		await nextTick();

		const item = itemOf(emittedGraphics(wrapper));
		expect(item?.themeBindings).toBeUndefined();
		expect(item?.type === 'text' && item.typography.color).toBe('#123456');
	});
});
