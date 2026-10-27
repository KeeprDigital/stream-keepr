import type { GraphicAnimationRecipe, GraphicOnScreenAnimationRecipe } from '~~/shared/types/graphics';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import AnimationRecipeFields from '~/components/Graphics/AnimationRecipeFields.vue';

// The one Graphic Animation Recipe fields control, shared by a lifecycle phase in the compositor
// and a Graphic Animation Recipe entry: the bounds it presents, what an empty field emits, which…

enableAutoUnmount(afterEach);

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		disabled: { type: Boolean, required: false },
		min: { type: Number, required: false },
		max: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" :disabled="disabled" />',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: String, required: false },
		items: {
			type: Array as () => { label: string; value: string }[],
			default: () => [],
		},
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: `<select :value="modelValue" :disabled="disabled">
		<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
	</select>`,
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: {
		modelValue: { type: Boolean, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" :disabled="disabled" />',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')">{{ label }}</button>',
});

const global = {
	stubs: {
		UFormField: defineComponent({
			props: {
				label: { type: String, required: false },
				help: { type: String, required: false },
			},
			template: '<div><label>{{ label }}</label><slot /><p v-if="help" class="help">{{ help }}</p></div>',
		}),
		UFieldGroup: defineComponent({ template: '<div><slot /></div>' }),
		UButton: UButtonStub,
		UInputNumber: UInputNumberStub,
		USelect: USelectStub,
		USwitch: USwitchStub,
	},
};

const RECIPE: GraphicAnimationRecipe = {
	duration: 400,
	easing: 'ease-out',
	delay: 0,
	fade: { opacity: 0 },
	slide: { direction: 'north-east', distanceMode: 'fixed', distance: 100 },
	scale: { factor: 0.8, origin: 'center' },
	reveal: { edge: 'left' },
};

/** A phase's recipe, or a motion token's, which may leave out its delay. */
type FieldsRecipe = Omit<GraphicAnimationRecipe, 'delay'> & Partial<Pick<GraphicOnScreenAnimationRecipe, 'delay' | 'pause' | 'repeat'>>;

interface SlideParent { width: number; height: number; name: 'canvas' | 'group' }

function mountFields(props: { recipe?: FieldsRecipe; cycling?: boolean; disabled?: boolean; slideParent?: SlideParent } = {}) {
	return mount(AnimationRecipeFields, {
		global,
		props: { recipe: RECIPE, testIdPrefix: 'recipe', ...props },
	});
}

type Wrapper = ReturnType<typeof mountFields>;

function control(wrapper: Wrapper, name: string, testId: string) {
	return wrapper.findAllComponents({ name }).find(entry => entry.attributes('data-testid') === `recipe-${testId}`);
}

async function enter(wrapper: Wrapper, name: string, testId: string, value: unknown) {
	control(wrapper, name, testId)!.vm.$emit('update:modelValue', value);
	await flushPromises();
}

describe('graphic animation recipe fields', () => {
	it('falls back to the shortest duration when the field is cleared', async () => {
		const wrapper = mountFields();

		await enter(wrapper, 'UInputNumber', 'duration', undefined);
		await enter(wrapper, 'UInputNumber', 'delay', undefined);

		// Zero would be a duration the write refuses.
		expect(wrapper.emitted('update')).toEqual([
			[
				{ duration: 50 },
			],
			[
				{ delay: 0 },
			],
		]);
	});

	it('shows a recipe with no delay of its own as starting immediately', () => {
		const { delay: _delay, ...undelayed } = RECIPE;
		const wrapper = mountFields({ recipe: undelayed });

		expect(control(wrapper, 'UInputNumber', 'delay')!.props('modelValue')).toBe(0);
	});

	it('switches a channel on with nothing of its own, and off with null', async () => {
		const { fade: _fade, ...unfaded } = RECIPE;
		const wrapper = mountFields({ recipe: unfaded });

		expect(control(wrapper, 'UInputNumber', 'fade-opacity')).toBeUndefined();
		await enter(wrapper, 'USwitch', 'fade-enabled', true);
		await enter(wrapper, 'USwitch', 'slide-enabled', false);

		// The host's merge fills a switched-on channel from its defaults.
		expect(wrapper.emitted('channel')).toEqual([
			['fade', {}],
			['slide', null],
		]);
	});

	it('emits one channel field at a time', async () => {
		const wrapper = mountFields();

		await enter(wrapper, 'USelect', 'slide-mode', 'clear-parent');
		await enter(wrapper, 'UInputNumber', 'scale-factor', 1.2);

		expect(wrapper.emitted('channel')).toEqual([
			[
				'slide',
				{ distanceMode: 'clear-parent' },
			],
			[
				'scale',
				{ factor: 1.2 },
			],
		]);
	});

	it('resets a cleared scale factor to no scale at all', async () => {
		const wrapper = mountFields();

		await enter(wrapper, 'UInputNumber', 'scale-factor', undefined);

		// Zero would be a scale from nothing, which nobody asked for by clearing the field.
		expect(wrapper.emitted('channel')).toEqual([
			[
				'scale',
				{ factor: 1 },
			],
		]);
	});

	it('hides the slide distance while the slide clears its parent instead', () => {
		const wrapper = mountFields({
			recipe: {
				...RECIPE,
				slide: { direction: 'north', distanceMode: 'clear-parent', distance: 0 },
			},
		});

		expect(control(wrapper, 'UInputNumber', 'slide-distance')).toBeUndefined();
		expect(control(wrapper, 'USelect', 'slide-mode')).toBeDefined();
	});

	it('offers pause and repetition only to a recipe that cycles', () => {
		expect(control(mountFields(), 'UInputNumber', 'pause')).toBeUndefined();
		expect(control(mountFields(), 'USwitch', 'repeat-indefinite')).toBeUndefined();

		const cycling = mountFields({
			cycling: true,
			recipe: { ...RECIPE, pause: 250, repeat: 3 },
		});
		const pause = control(cycling, 'UInputNumber', 'pause')!;
		expect([
			pause.props('modelValue'),
			pause.props('max'),
		]).toEqual([250, 60000]);
		const repeat = control(cycling, 'UInputNumber', 'repeat')!;
		expect([
			repeat.props('modelValue'),
			repeat.props('min'),
			repeat.props('max'),
		]).toEqual([3, 1, 100]);
	});

	it('will not ask for a repeat count while the recipe repeats indefinitely', async () => {
		const wrapper = mountFields({
			cycling: true,
			recipe: { ...RECIPE, pause: 0, repeat: 'indefinite' },
		});

		expect(control(wrapper, 'UInputNumber', 'repeat')!.props('disabled')).toBe(true);

		await enter(wrapper, 'USwitch', 'repeat-indefinite', false);
		await enter(wrapper, 'UInputNumber', 'pause', undefined);
		await enter(wrapper, 'UInputNumber', 'repeat', 2.6);

		// A whole count rather than nothing, which is a recipe the write accepts.
		expect(wrapper.emitted('update')).toEqual([
			[
				{ repeat: 1 },
			],
			[
				{ pause: 0 },
			],
			[
				{ repeat: 3 },
			],
		]);
	});

	describe('slide distance in a Geometry Unit', () => {
		const CANVAS: SlideParent = { width: 1920, height: 1080, name: 'canvas' };

		function slideRecipe(direction: 'east' | 'north' | 'north-east', distance = 192): FieldsRecipe {
			return {
				...RECIPE,
				slide: { direction, distanceMode: 'fixed', distance },
			};
		}

		async function chooseUnit(wrapper: Wrapper, label: 'px' | '%' | '±16') {
			await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click');
			await flushPromises();
		}

		function help(wrapper: Wrapper) {
			return wrapper.findAll('.help').map(entry => entry.text());
		}

		beforeEach(() => {
			localStorage.clear();
		});

		it('stays in pixels, with no unit choice, without a parent to measure against', () => {
			const wrapper = mountFields({
				recipe: slideRecipe('east'),
			});

			expect(wrapper.findAll('button').filter(button => ['px', '%', '±16'].includes(button.text()))).toEqual([]);
			expect(control(wrapper, 'UInputNumber', 'slide-distance')!.props('modelValue')).toBe(192);
			expect(wrapper.text()).toContain('Fixed distance (px)');
		});

		it('measures a horizontal slide against the parent width and emits pixels', async () => {
			const wrapper = mountFields({
				recipe: slideRecipe('east'),
				slideParent: CANVAS,
			});
			await chooseUnit(wrapper, '%');

			const distance = control(wrapper, 'UInputNumber', 'slide-distance')!;
			expect([
				distance.props('modelValue'),
				distance.props('min'),
				distance.props('max'),
			]).toEqual([10, 0, 520.83]);
			expect(help(wrapper)).toEqual(['% of canvas width']);

			await enter(wrapper, 'UInputNumber', 'slide-distance', 25);
			expect(wrapper.emitted('channel')).toEqual([
				[
					'slide',
					{ distance: 480 },
				],
			]);
		});

		it('measures a vertical slide against the parent height', async () => {
			const wrapper = mountFields({
				recipe: slideRecipe('north', 108),
				slideParent: { ...CANVAS, name: 'group' },
			});
			await chooseUnit(wrapper, '±16');

			expect(control(wrapper, 'UInputNumber', 'slide-distance')!.props('modelValue')).toBe(3.2);
			expect(help(wrapper)).toEqual(['32-unit grid across group height']);

			await enter(wrapper, 'UInputNumber', 'slide-distance', 16);
			expect(wrapper.emitted('channel')).toEqual([
				[
					'slide',
					{ distance: 540 },
				],
			]);
		});

		it('measures a diagonal slide against the parent\'s shorter side', async () => {
			const wrapper = mountFields({
				recipe: slideRecipe('north-east', 108),
				slideParent: CANVAS,
			});
			await chooseUnit(wrapper, '%');

			expect(control(wrapper, 'UInputNumber', 'slide-distance')!.props('modelValue')).toBe(10);
			expect(help(wrapper)).toEqual(['% of canvas shorter side']);
		});

		it('names no reference in pixels, and clamps an entry to what a write accepts', async () => {
			const wrapper = mountFields({
				recipe: slideRecipe('east'),
				slideParent: CANVAS,
			});
			await flushPromises();

			expect(help(wrapper)).toEqual([]);
			await chooseUnit(wrapper, '%');
			await enter(wrapper, 'UInputNumber', 'slide-distance', 900);
			await enter(wrapper, 'UInputNumber', 'slide-distance', undefined);

			expect(wrapper.emitted('channel')).toEqual([
				[
					'slide',
					{ distance: 10000 },
				],
				[
					'slide',
					{ distance: 0 },
				],
			]);
		});

		it('lets a reader who may not write still switch the unit they read in', async () => {
			const wrapper = mountFields({
				recipe: slideRecipe('east'),
				slideParent: CANVAS,
				disabled: true,
			});
			await chooseUnit(wrapper, '%');

			expect(control(wrapper, 'UInputNumber', 'slide-distance')!.props('modelValue')).toBe(10);
			expect(wrapper.emitted('channel')).toBeUndefined();
		});

		it('opens in the Geometry Unit the geometry fields last used', async () => {
			localStorage.setItem('editor-geometryUnit', 'percent');
			const wrapper = mountFields({
				recipe: slideRecipe('east'),
				slideParent: CANVAS,
			});
			await flushPromises();

			expect(control(wrapper, 'UInputNumber', 'slide-distance')!.props('modelValue')).toBe(10);
		});
	});

	it('disables every field for a reader who may not write', () => {
		const wrapper = mountFields({
			cycling: true,
			disabled: true,
			recipe: { ...RECIPE, pause: 0, repeat: 2 },
		});

		const controls = wrapper.findAll('input, select');
		expect(controls.length).toBeGreaterThan(0);
		for (const entry of controls)
			expect((entry.element as HTMLInputElement | HTMLSelectElement).disabled).toBe(true);
	});
});
