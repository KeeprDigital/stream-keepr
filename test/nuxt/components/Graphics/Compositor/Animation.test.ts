import type {
	BroadcastGraphicConfig,
	GraphicGroupItemConfig,
	GraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { createDefaultGraphicAnimationRecipe, DEFAULT_GRAPHIC_TYPOGRAPHY, squareShapeGeometry } from '~~/shared/modules/graphics';

enableAutoUnmount(afterEach);

function shape(id: string): GraphicItemConfig {
	return {
		type: 'shape',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 400,
		height: 100,
		geometry: squareShapeGeometry(),
		surfaceStyle: { fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 1 },
	};
}

function text(id: string): GraphicGroupItemConfig['children'][number] {
	return {
		type: 'text',
		id,
		label: id,
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
}

function group(id: string, childIds: string[]): GraphicGroupItemConfig {
	return {
		type: 'group',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 800,
		height: 200,
		arrangement: 'row',
		padding: 0,
		gap: 16,
		align: 'stretch',
		justify: 'start',
		clip: false,
		geometry: squareShapeGeometry(),
		children: childIds.map(childId => text(childId)),
	};
}

function stack(items: GraphicItemConfig[] = [shape('bar'), shape('name')]): BroadcastGraphicConfig[] {
	return [{ id: 'lower-third', name: 'Lower Third', items }];
}

const SlotOnlyStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div><span>{{ label }}</span><slot /></div>',
});

const USelectMenuStub = defineComponent({
	name: 'USelectMenu',
	props: { modelValue: { type: [String, Number], required: false }, items: { type: Array, required: false } },
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" />',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		disabled: { type: Boolean, required: false },
		// Declared so the bounds the editor presents are readable: a control whose
		// bounds are wider than the vocabulary's would accept a value the write refuses.
		min: { type: Number, required: false },
		max: { type: Number, required: false },
		step: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" :disabled="disabled" />',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	writable?: boolean;
}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Animation.vue';
	const { default: Animation } = await import(componentPath);

	return mount(Animation, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget,
			writable: options.writable ?? true,
		},
		global: {
			stubs: {
				UFormField: SlotOnlyStub,
				USelectMenu: USelectMenuStub,
				UInputNumber: UInputNumberStub,
				USwitch: USwitchStub,
				UBadge: true,
				UIcon: true,
			},
		},
	});
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

function emittedGraphics(wrapper: Wrapper, index = 0) {
	return wrapper.emitted('update:graphics')?.[index]?.[0] as BroadcastGraphicConfig[];
}

function switchField(wrapper: Wrapper, testId: string) {
	return wrapper.findAllComponents({ name: 'USwitch' })
		.find(entry => entry.attributes('data-testid') === testId);
}

function numberField(wrapper: Wrapper, testId: string) {
	return wrapper.findAllComponents({ name: 'UInputNumber' })
		.find(entry => entry.attributes('data-testid') === testId);
}

function selectField(wrapper: Wrapper, testId: string) {
	return wrapper.findAllComponents({ name: 'USelectMenu' })
		.find(entry => entry.attributes('data-testid') === testId);
}

const GRAPHIC_TARGET: GraphicsSelectionTarget = { type: 'graphic', graphicId: 'lower-third' };
const ITEM_TARGET: GraphicsSelectionTarget = { type: 'item', graphicId: 'lower-third', itemId: 'bar' };

describe('graphicAnimationEditor', () => {
	it('offers no controls for the canvas, which owns no animation', async () => {
		const wrapper = await mountComponent({ graphics: stack(), selectedTarget: { type: 'canvas' } });

		expect(wrapper.find('[data-testid="graphic-animation-editor"]').exists()).toBe(false);
	});

	it('shows every lifecycle phase disabled for a newly authored Graphic Item', async () => {
		const wrapper = await mountComponent({ graphics: stack(), selectedTarget: ITEM_TARGET });

		for (const phase of ['enter', 'on-screen', 'update', 'exit']) {
			expect(switchField(wrapper, `animation-${phase}-enabled`)?.props('modelValue')).toBe(false);
			// Nothing to edit until a phase is enabled.
			expect(numberField(wrapper, `animation-${phase}-duration`)).toBeUndefined();
		}
	});

	it('enables one phase with its editable default recipe', async () => {
		const wrapper = await mountComponent({ graphics: stack(), selectedTarget: ITEM_TARGET });

		switchField(wrapper, 'animation-enter-enabled')!.vm.$emit('update:modelValue', true);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]?.animation)
			.toEqual({ enter: createDefaultGraphicAnimationRecipe('enter') });
	});

	it('disables one phase without disturbing another', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = {
			enter: createDefaultGraphicAnimationRecipe('enter'),
			exit: createDefaultGraphicAnimationRecipe('exit'),
		};
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		switchField(wrapper, 'animation-enter-enabled')!.vm.$emit('update:modelValue', false);
		await nextTick();

		const animation = emittedGraphics(wrapper)[0]?.items[0]?.animation;
		expect(animation?.enter).toBeUndefined();
		expect(animation?.exit).toBeDefined();
	});

	it('edits timing within the settled bounds it presents', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = { enter: createDefaultGraphicAnimationRecipe('enter') };
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		const duration = numberField(wrapper, 'animation-enter-duration')!;
		expect(duration.props('min')).toBe(50);
		expect(duration.props('max')).toBe(10000);
		duration.vm.$emit('update:modelValue', 900);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]?.animation?.enter?.duration).toBe(900);
	});

	it('bounds a delay to ten seconds, as the vocabulary does', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = { enter: createDefaultGraphicAnimationRecipe('enter') };
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		const delay = numberField(wrapper, 'animation-enter-delay')!;
		expect(delay.props('min')).toBe(0);
		expect(delay.props('max')).toBe(10000);
	});

	it('adds and removes one channel without disturbing the recipe others', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = { enter: createDefaultGraphicAnimationRecipe('enter') };
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		switchField(wrapper, 'animation-enter-slide-enabled')!.vm.$emit('update:modelValue', true);
		await nextTick();

		const withSlide = emittedGraphics(wrapper)[0]?.items[0]?.animation?.enter;
		expect(withSlide?.slide).toEqual({ direction: 'north', distanceMode: 'fixed', distance: 100 });
		// The fade the default recipe came with is still there.
		expect(withSlide?.fade).toEqual({ opacity: 0 });
	});

	it('hides a fixed slide distance while the slide clears its parent instead', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = {
			enter: {
				duration: 400,
				easing: 'linear',
				delay: 0,
				slide: { direction: 'north', distanceMode: 'clear-parent', distance: 0 },
			},
		};
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		expect(numberField(wrapper, 'animation-enter-slide-distance')).toBeUndefined();
		expect(selectField(wrapper, 'animation-enter-slide-mode')).toBeDefined();
	});

	it('offers a scale origin independent of the Graphic Anchor Point', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = {
			enter: { duration: 400, easing: 'linear', delay: 0, scale: { factor: 0.8, origin: 'center' } },
		};
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		const origin = selectField(wrapper, 'animation-enter-scale-origin')!;
		expect((origin.props('items') as unknown[]).length).toBe(9);

		origin.vm.$emit('update:modelValue', 'bottom-right');
		await nextTick();

		const scale = emittedGraphics(wrapper)[0]?.items[0]?.animation?.enter?.scale;
		// The anchor is untouched: the two are separate vocabularies.
		expect(scale).toEqual({ factor: 0.8, origin: 'bottom-right' });
		expect(emittedGraphics(wrapper)[0]?.items[0]?.anchor).toBe('top-left');
	});

	it('offers on-screen repetition and pause only on the phase that cycles', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = {
			'enter': createDefaultGraphicAnimationRecipe('enter'),
			'on-screen': createDefaultGraphicAnimationRecipe('on-screen'),
		};
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		expect(numberField(wrapper, 'animation-on-screen-pause')).toBeDefined();
		expect(switchField(wrapper, 'animation-on-screen-indefinite')?.props('modelValue')).toBe(true);
		// A repeat count is inert while a recipe repeats indefinitely.
		expect(numberField(wrapper, 'animation-on-screen-repeat')?.props('disabled')).toBe(true);
	});

	it('turns an indefinite repetition into a finite one', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = { 'on-screen': createDefaultGraphicAnimationRecipe('on-screen') };
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		switchField(wrapper, 'animation-on-screen-indefinite')!.vm.$emit('update:modelValue', false);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]?.animation?.['on-screen']?.repeat).toBe(1);
	});

	it('initialises a recipe from a preset', async () => {
		const graphics = stack();
		graphics[0]!.items[0]!.animation = { enter: createDefaultGraphicAnimationRecipe('enter') };
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		selectField(wrapper, 'animation-enter-preset')!.vm.$emit('update:modelValue', 'pop-in');
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]?.animation?.enter)
			.toMatchObject({ scale: { factor: 0.8, origin: 'center' } });
	});

	it('never changes the Graphic Resting State of what it animates', async () => {
		const graphics = stack();
		const before = structuredClone(graphics[0]!.items[0]!);
		const wrapper = await mountComponent({ graphics, selectedTarget: ITEM_TARGET });

		switchField(wrapper, 'animation-enter-enabled')!.vm.$emit('update:modelValue', true);
		await nextTick();

		const { animation: _animation, ...resting } = emittedGraphics(wrapper)[0]!.items[0]!;
		expect(resting).toEqual(before);
	});

	it('authors whole-graphic animation when the Broadcast Graphic is selected', async () => {
		const wrapper = await mountComponent({ graphics: stack(), selectedTarget: GRAPHIC_TARGET });

		switchField(wrapper, 'animation-exit-enabled')!.vm.$emit('update:modelValue', true);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.animation?.exit)
			.toEqual(createDefaultGraphicAnimationRecipe('exit'));
		// The items are untouched: whole-graphic motion composes with theirs.
		expect(emittedGraphics(wrapper)[0]?.items).toEqual(stack()[0]?.items);
	});

	it('changes nothing at all while the session does not hold the authoring lease', async () => {
		const wrapper = await mountComponent({ graphics: stack(), selectedTarget: ITEM_TARGET, writable: false });

		expect(wrapper.get('[data-testid="graphic-animation-editor"]').attributes('disabled')).toBeDefined();

		switchField(wrapper, 'animation-enter-enabled')!.vm.$emit('update:modelValue', true);
		await nextTick();

		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});

	it('fails closed when no caller states that this session may author', async () => {
		const componentPath = '../../../../../app/components/Graphics/Compositor/Animation.vue';
		const { default: Animation } = await import(componentPath);
		const wrapper = mount(Animation, {
			props: { graphics: stack(), selectedTarget: ITEM_TARGET },
			global: { stubs: { UFormField: SlotOnlyStub, USelectMenu: USelectMenuStub, UInputNumber: UInputNumberStub, USwitch: USwitchStub, UBadge: true, UIcon: true } },
		});

		expect(wrapper.get('[data-testid="graphic-animation-editor"]').attributes('disabled')).toBeDefined();
	});
});

describe('stagger authoring in the editor', () => {
	it('offers a stagger on a Broadcast Graphic, over its own direct Graphic Items', async () => {
		const wrapper = await mountComponent({ graphics: stack(), selectedTarget: GRAPHIC_TARGET });

		switchField(wrapper, 'animation-enter-stagger-enabled')!.vm.$emit('update:modelValue', true);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.animation?.stagger?.enter)
			.toEqual({ order: 'list', step: 100, itemIds: [] });
	});

	it('offers no stagger on a Graphic Item with no direct items of its own', async () => {
		const wrapper = await mountComponent({ graphics: stack(), selectedTarget: ITEM_TARGET });

		expect(switchField(wrapper, 'animation-enter-stagger-enabled')).toBeUndefined();
	});

	it('offers a stagger on a Graphic Group, over its children', async () => {
		const groupItem = group('cluster', ['one', 'two']);
		groupItem.animation = { stagger: { enter: { order: 'list', step: 100, itemIds: ['one'] } } };
		const wrapper = await mountComponent({
			graphics: stack([groupItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'cluster' },
		});

		expect(switchField(wrapper, 'animation-enter-stagger-member-one')?.props('modelValue')).toBe(true);
		expect(switchField(wrapper, 'animation-enter-stagger-member-two')?.props('modelValue')).toBe(false);

		switchField(wrapper, 'animation-enter-stagger-member-two')!.vm.$emit('update:modelValue', true);
		await nextTick();

		const staggered = emittedGraphics(wrapper)[0]?.items[0];
		expect(staggered?.type === 'group' && staggered.animation?.stagger?.enter?.itemIds)
			.toEqual(['one', 'two']);
	});

	it('selects the subset a stagger orders', async () => {
		const graphics = stack();
		graphics[0]!.animation = { stagger: { enter: { order: 'list', step: 100, itemIds: [] } } };
		const wrapper = await mountComponent({ graphics, selectedTarget: GRAPHIC_TARGET });

		switchField(wrapper, 'animation-enter-stagger-member-name')!.vm.$emit('update:modelValue', true);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.animation?.stagger?.enter?.itemIds).toEqual(['name']);
	});

	it('reverses one phase stagger without reversing another', async () => {
		const graphics = stack();
		graphics[0]!.animation = {
			stagger: {
				enter: { order: 'list', step: 100, itemIds: ['bar', 'name'] },
				exit: { order: 'list', step: 100, itemIds: ['bar', 'name'] },
			},
		};
		const wrapper = await mountComponent({ graphics, selectedTarget: GRAPHIC_TARGET });

		selectField(wrapper, 'animation-exit-stagger-order')!.vm.$emit('update:modelValue', 'reverse-list');
		await nextTick();

		const stagger = emittedGraphics(wrapper)[0]?.animation?.stagger;
		expect(stagger?.exit?.order).toBe('reverse-list');
		expect(stagger?.enter?.order).toBe('list');
	});

	it('bounds a stagger step to ten seconds', async () => {
		const graphics = stack();
		graphics[0]!.animation = { stagger: { enter: { order: 'list', step: 100, itemIds: [] } } };
		const wrapper = await mountComponent({ graphics, selectedTarget: GRAPHIC_TARGET });

		expect(numberField(wrapper, 'animation-enter-stagger-step')?.props('max')).toBe(10000);
	});

	it('lets a container order its items without animating itself', async () => {
		const wrapper = await mountComponent({ graphics: stack(), selectedTarget: GRAPHIC_TARGET });

		switchField(wrapper, 'animation-enter-stagger-enabled')!.vm.$emit('update:modelValue', true);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.animation?.enter).toBeUndefined();
	});
});
