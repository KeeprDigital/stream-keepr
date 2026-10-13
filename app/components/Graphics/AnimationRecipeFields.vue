<script setup lang="ts">
import type { GraphicAnimationChannelKey, GraphicAnimationChannels } from '~~/shared/modules/graphics';
import type {
	GraphicAnimationEasing,
	GraphicAnimationRecipe,
	GraphicOnScreenAnimationRecipe,
	GraphicRevealEdge,
	GraphicSlideDistanceMode,
} from '~~/shared/types/graphics';
import { GRAPHIC_SLIDE_DIRECTIONS } from '~~/shared/modules/graphics';
import {
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_REPEAT_INDEFINITE,
	GRAPHIC_REVEAL_EDGE_VALUES,
	GRAPHIC_SLIDE_DISTANCE_MODE_VALUES,
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_PAUSE_MS,
	MAX_GRAPHIC_ANIMATION_REPEAT,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_SLIDE_DISTANCE_PX,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_REPEAT,
} from '~~/shared/types/graphics';

/**
 * The one Graphic Animation Recipe fields control, for a lifecycle phase's recipe
 * in the compositor and for a Graphic Animation Recipe preset in a Graphic Style Set.
 *
 * It edits the recipe body only: timing, easing, and the fade, slide, scale, and
 * reveal channels. Enabling a phase, presets, Style Set references, and staggers
 * are the host's. Every edit is emitted as a patch, and the host applies it with
 * its own merge: `update` for a recipe field, `channel` for one channel's fields,
 * or null to remove that channel. A switched-on channel is emitted empty, so the
 * shared channel defaults fill it, whichever host it lands in.
 *
 * A cleared field emits the nearest value a write accepts: the shortest duration,
 * no delay, no pause, one repetition, or zero. A repetition is a whole number.
 *
 * Pause and repetition belong to the phase that cycles, so a host offers them with
 * `cycling`: on-screen, and a Style Set preset, which any phase may reference.
 */
const props = defineProps<{
	/**
	 * A phase's recipe, or a Style Set preset's, which may leave out its delay and
	 * its on-screen defaults.
	 */
	recipe: Omit<GraphicAnimationRecipe, 'delay'> & Partial<Pick<GraphicOnScreenAnimationRecipe, 'delay' | 'pause' | 'repeat'>>;
	cycling?: boolean;
	disabled?: boolean;
	/** Prefixes every field's test id, e.g. `animation-enter`. */
	testIdPrefix: string;
}>();

const emit = defineEmits<{
	update: [patch: Partial<Pick<GraphicOnScreenAnimationRecipe, 'duration' | 'easing' | 'delay' | 'pause' | 'repeat'>>];
	channel: GraphicAnimationChannelEdit;
}>();

/** A channel and a patch of that same channel, or null to remove it. */
type GraphicAnimationChannelEdit = {
	[K in GraphicAnimationChannelKey]: [channel: K, patch: Partial<GraphicAnimationChannels[K]> | null];
}[GraphicAnimationChannelKey];

const EASING_LABELS: Record<GraphicAnimationEasing, string> = {
	'linear': 'Linear',
	'ease-in': 'Ease in',
	'ease-out': 'Ease out',
	'ease-in-out': 'Ease in-out',
	'back-in': 'Back in',
	'back-out': 'Back out',
	'back-in-out': 'Back in-out',
};
const DISTANCE_MODE_LABELS: Record<GraphicSlideDistanceMode, string> = {
	'fixed': 'Fixed',
	'clear-parent': 'Clear parent',
};
const REVEAL_EDGE_LABELS: Record<GraphicRevealEdge, string> = {
	left: 'Left',
	right: 'Right',
	top: 'Top',
	bottom: 'Bottom',
};

const EASING_OPTIONS = GRAPHIC_ANIMATION_EASING_VALUES.map(value => ({ label: EASING_LABELS[value], value }));
const DIRECTION_OPTIONS = GRAPHIC_SLIDE_DIRECTIONS.map(entry => ({ label: entry.label, value: entry.value }));
const DISTANCE_MODE_OPTIONS = GRAPHIC_SLIDE_DISTANCE_MODE_VALUES.map(value => ({ label: DISTANCE_MODE_LABELS[value], value }));
const REVEAL_EDGE_OPTIONS = GRAPHIC_REVEAL_EDGE_VALUES.map(value => ({ label: REVEAL_EDGE_LABELS[value], value }));

const CHANNELS: readonly { key: GraphicAnimationChannelKey; label: string }[] = [
	{ key: 'fade', label: 'Fade' },
	{ key: 'slide', label: 'Slide' },
	{ key: 'scale', label: 'Scale' },
	{ key: 'reveal', label: 'Reveal' },
];

const repeatsIndefinitely = computed(() => props.recipe.repeat === GRAPHIC_ANIMATION_REPEAT_INDEFINITE);

function testId(field: string) {
	return `${props.testIdPrefix}-${field}`;
}
</script>

<template>
	<div class="space-y-2">
		<div class="grid grid-cols-2 gap-2">
			<UFormField label="Duration (ms)" size="xs">
				<UInputNumber
					:model-value="recipe.duration"
					:min="MIN_GRAPHIC_ANIMATION_DURATION_MS"
					:max="MAX_GRAPHIC_ANIMATION_DURATION_MS"
					size="xs"
					:disabled="disabled"
					:data-testid="testId('duration')"
					@update:model-value="value => emit('update', { duration: value ?? MIN_GRAPHIC_ANIMATION_DURATION_MS })"
				/>
			</UFormField>
			<UFormField label="Delay (ms)" size="xs">
				<UInputNumber
					:model-value="recipe.delay ?? 0"
					:min="0"
					:max="MAX_GRAPHIC_ANIMATION_DELAY_MS"
					size="xs"
					:disabled="disabled"
					:data-testid="testId('delay')"
					@update:model-value="value => emit('update', { delay: value ?? 0 })"
				/>
			</UFormField>
		</div>

		<UFormField label="Easing" size="xs">
			<USelect
				:model-value="recipe.easing"
				:items="EASING_OPTIONS"
				value-key="value"
				size="xs"
				class="w-full"
				:disabled="disabled"
				:data-testid="testId('easing')"
				@update:model-value="value => emit('update', { easing: value })"
			/>
		</UFormField>

		<template v-if="cycling">
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Pause (ms)" size="xs">
					<UInputNumber
						:model-value="recipe.pause ?? 0"
						:min="0"
						:max="MAX_GRAPHIC_ANIMATION_PAUSE_MS"
						size="xs"
						:disabled="disabled"
						:data-testid="testId('pause')"
						@update:model-value="value => emit('update', { pause: value ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Repeat" size="xs">
					<UInputNumber
						:model-value="repeatsIndefinitely ? undefined : Number(recipe.repeat ?? MIN_GRAPHIC_ANIMATION_REPEAT)"
						:min="MIN_GRAPHIC_ANIMATION_REPEAT"
						:max="MAX_GRAPHIC_ANIMATION_REPEAT"
						:disabled="disabled || repeatsIndefinitely"
						size="xs"
						:data-testid="testId('repeat')"
						:step="1"
						@update:model-value="value => emit('update', { repeat: value == null ? MIN_GRAPHIC_ANIMATION_REPEAT : Math.round(value) })"
					/>
				</UFormField>
			</div>
			<UFormField label="Repeat indefinitely" size="xs" class="flex items-center gap-2">
				<USwitch
					:model-value="repeatsIndefinitely"
					size="sm"
					:disabled="disabled"
					:data-testid="testId('repeat-indefinite')"
					@update:model-value="value => emit('update', {
						repeat: value === true ? GRAPHIC_ANIMATION_REPEAT_INDEFINITE : MIN_GRAPHIC_ANIMATION_REPEAT,
					})"
				/>
			</UFormField>
		</template>

		<div
			v-for="channel in CHANNELS"
			:key="channel.key"
			class="rounded border border-default/50 p-2"
		>
			<div class="flex items-center justify-between gap-2">
				<p class="text-xs">
					{{ channel.label }}
				</p>
				<USwitch
					:model-value="recipe[channel.key] !== undefined"
					size="sm"
					:disabled="disabled"
					:aria-label="`${channel.label} channel`"
					:data-testid="testId(`${channel.key}-enabled`)"
					@update:model-value="value => emit('channel', channel.key, value === true ? {} : null)"
				/>
			</div>

			<div v-if="channel.key === 'fade' && recipe.fade" class="mt-2">
				<UFormField label="Opacity at excursion" size="xs">
					<UIOpacityInput
						:model-value="recipe.fade.opacity"
						size="xs"
						:disabled="disabled"
						:data-testid="testId('fade-opacity')"
						@update:model-value="value => emit('channel', 'fade', { opacity: value ?? 0 })"
					/>
				</UFormField>
			</div>

			<div v-if="channel.key === 'slide' && recipe.slide" class="mt-2 space-y-2">
				<UFormField label="Direction" size="xs">
					<USelect
						:model-value="recipe.slide.direction"
						:items="DIRECTION_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						:data-testid="testId('slide-direction')"
						@update:model-value="value => emit('channel', 'slide', { direction: value })"
					/>
				</UFormField>
				<UFormField label="Distance" size="xs">
					<USelect
						:model-value="recipe.slide.distanceMode"
						:items="DISTANCE_MODE_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						:data-testid="testId('slide-mode')"
						@update:model-value="value => emit('channel', 'slide', { distanceMode: value })"
					/>
				</UFormField>
				<!-- The fixed distance: the one place the slide's length is entered. -->
				<UFormField v-if="recipe.slide.distanceMode === 'fixed'" label="Distance (px)" size="xs">
					<UInputNumber
						:model-value="recipe.slide.distance"
						:min="0"
						:max="MAX_GRAPHIC_SLIDE_DISTANCE_PX"
						size="xs"
						:disabled="disabled"
						:data-testid="testId('slide-distance')"
						@update:model-value="value => emit('channel', 'slide', { distance: value ?? 0 })"
					/>
				</UFormField>
			</div>

			<div v-if="channel.key === 'scale' && recipe.scale" class="mt-2 space-y-2">
				<UFormField label="Factor" size="xs">
					<UInputNumber
						:model-value="recipe.scale.factor"
						:min="0"
						:max="MAX_GRAPHIC_ANIMATION_SCALE"
						:step="0.05"
						size="xs"
						:disabled="disabled"
						:data-testid="testId('scale-factor')"
						@update:model-value="value => emit('channel', 'scale', { factor: value ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Origin" size="xs">
					<UINinePointPicker
						:model-value="recipe.scale.origin"
						aria-label="Scale origin"
						:disabled="disabled"
						:data-testid="testId('scale-origin')"
						@update:model-value="value => emit('channel', 'scale', { origin: value })"
					/>
				</UFormField>
			</div>

			<div v-if="channel.key === 'reveal' && recipe.reveal" class="mt-2">
				<UFormField label="From edge" size="xs">
					<USelect
						:model-value="recipe.reveal.edge"
						:items="REVEAL_EDGE_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						:data-testid="testId('reveal-edge')"
						@update:model-value="value => emit('channel', 'reveal', { edge: value })"
					/>
				</UFormField>
			</div>
		</div>
	</div>
</template>
