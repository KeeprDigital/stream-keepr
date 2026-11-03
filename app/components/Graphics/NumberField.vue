<script setup lang="ts">
import type { NumberScrub } from '~/modules/graphics/numberScrub';
import { NUMBER_SCRUB_GESTURE, scrubNumber, startNumberScrub } from '~/modules/graphics/numberScrub';

/**
 * A graphics inspector's number field: a labelled number input whose label drags
 * the value (E29). Each step of a drag is emitted like a typed value, so it takes
 * the same write path as typing: debounced, and refused without the Graphics
 * Authoring Lease (E30). An editor with undo provides `NUMBER_SCRUB_GESTURE` to
 * make one drag one undo step.
 *
 * The label is keyboard-neutral: it is not focusable, and a plain click still
 * focuses the input, which stays the accessible way to set a value. A disabled
 * field, or one in a disabled fieldset, does not scrub.
 *
 * `class` lays out the field; every other attribute (aria-*, data-*) lands on the input.
 */
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
	label: string;
	modelValue: number | null | undefined;
	min?: number;
	max?: number;
	/** The displayed step: the arrows', and the drag's per 2px. */
	step?: number;
	stepSnapping?: boolean;
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
	disabled?: boolean;
}>(), {
	step: 1,
	stepSnapping: undefined,
	size: 'sm',
});

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();

const attrs = useAttrs();
const inputAttrs = computed(() => {
	const { class: _class, ...rest } = attrs;
	return rest;
});

const gesture = inject(NUMBER_SCRUB_GESTURE, null);

const handle = useTemplateRef<HTMLElement>('handle');

interface ActiveScrub {
	pointerId: number;
	lastX: number;
	scrub: NumberScrub;
	/** Whether the drag has changed the value, which opens the editor's gesture. */
	changed: boolean;
}

const active = shallowRef<ActiveScrub | null>(null);
/** A drag that changed the value ends in a click, which must not focus the input. */
let swallowClick = false;

function isDisabled() {
	return props.disabled || handle.value?.closest('fieldset[disabled]') != null;
}

function start(event: PointerEvent) {
	if (event.button !== 0 || isDisabled())
		return;
	event.preventDefault();
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	const value = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, props.modelValue ?? 0));
	swallowClick = false;
	active.value = {
		pointerId: event.pointerId,
		lastX: event.clientX,
		scrub: startNumberScrub(value),
		changed: false,
	};
}

function move(event: PointerEvent) {
	const current = active.value;
	if (!current || event.pointerId !== current.pointerId)
		return;
	const scrub = scrubNumber(current.scrub, {
		dx: event.clientX - current.lastX,
		step: props.step,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
		min: props.min,
		max: props.max,
	});
	const changed = scrub.value !== current.scrub.value;
	if (changed && !current.changed)
		gesture?.begin();
	active.value = {
		...current,
		lastX: event.clientX,
		scrub,
		changed: current.changed || changed,
	};
	if (changed)
		emit('update:modelValue', scrub.value);
}

function end(event?: PointerEvent) {
	const current = active.value;
	if (!current || (event && event.pointerId !== current.pointerId))
		return;
	active.value = null;
	if (current.changed) {
		swallowClick = true;
		gesture?.end();
	}
}

function click(event: MouseEvent) {
	if (swallowClick)
		event.preventDefault();
	swallowClick = false;
}

onBeforeUnmount(() => end());
</script>

<template>
	<UFormField :size="size" :class="attrs.class">
		<template #label>
			<span
				ref="handle"
				class="number-scrub"
				:class="{ 'number-scrub--disabled': disabled }"
				title="Drag to change: Shift ×10, Alt ×0.1"
				data-number-scrub
				:data-scrubbing="active ? 'true' : undefined"
				@pointerdown="start"
				@pointermove="move"
				@pointerup="end"
				@pointercancel="end"
				@lostpointercapture="end"
				@click="click"
			>{{ label }}</span>
		</template>
		<UInputNumber
			v-bind="inputAttrs"
			:model-value="modelValue"
			:min="min"
			:max="max"
			:step="step"
			:step-snapping="stepSnapping"
			:size="size"
			:disabled="disabled"
			class="w-full"
			@update:model-value="emit('update:modelValue', $event ?? null)"
		/>
	</UFormField>
</template>

<style scoped>
.number-scrub {
	cursor: ew-resize;
	touch-action: none;
	user-select: none;
}

.number-scrub--disabled,
:global(fieldset:disabled) .number-scrub {
	cursor: auto;
}
</style>
