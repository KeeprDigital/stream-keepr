<script setup lang="ts">
import type { NinePoint } from '~~/shared/utils/ninePoints';
import { NINE_POINTS } from '~~/shared/utils/ninePoints';

/**
 * The one control for any nine-point value — a Graphic Anchor Point, a Graphic
 * Animation Origin, a Feature Match Overlay anchor: a 3×3 grid of icon buttons
 * laid out where each point sits on the rectangle.
 *
 * A radio group: one tab stop on the current point, arrow keys move across the
 * grid. Name it with an `aria-label`, which falls through to the group.
 */
withDefaults(defineProps<{
	disabled?: boolean;
	size?: 'xs' | 'sm';
}>(), {
	disabled: false,
	size: 'xs',
});

const model = defineModel<NinePoint>({ required: true });

const group = useTemplateRef<HTMLElement>('group');

const ARROW_MOVES: Record<string, [row: number, column: number]> = {
	ArrowUp: [-1, 0],
	ArrowDown: [1, 0],
	ArrowLeft: [0, -1],
	ArrowRight: [0, 1],
};

function moveFrom(index: number, event: KeyboardEvent) {
	const move = ARROW_MOVES[event.key];
	if (!move)
		return;
	event.preventDefault();
	const row = Math.floor(index / 3) + move[0];
	const column = (index % 3) + move[1];
	if (row < 0 || row > 2 || column < 0 || column > 2)
		return;
	const next = NINE_POINTS[(row * 3) + column]!.value;
	model.value = next;
	void nextTick(() => group.value?.querySelector<HTMLElement>(`[data-point="${next}"]`)?.focus());
}
</script>

<template>
	<div ref="group" class="grid w-fit grid-cols-3 gap-1" role="radiogroup">
		<UButton
			v-for="(point, index) in NINE_POINTS"
			:key="point.value"
			:data-point="point.value"
			role="radio"
			:aria-label="point.label"
			:aria-checked="model === point.value"
			:tabindex="model === point.value ? 0 : -1"
			:title="point.label"
			:icon="point.icon"
			:size="size"
			:disabled="disabled"
			color="neutral"
			:variant="model === point.value ? 'solid' : 'soft'"
			class="size-7 justify-center p-0"
			@click="model = point.value"
			@keydown="moveFrom(index, $event)"
		/>
	</div>
</template>
