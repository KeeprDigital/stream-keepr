<script setup lang="ts">
import type { GraphicAnimationPhase } from '~~/shared/types/graphics';
import type { GraphicsPreviewAnimationPlan, GraphicsPreviewAnimationScope } from '~/modules/graphics/previewMessages';
import { GRAPHIC_ANIMATION_PHASE_LABELS } from '~~/shared/modules/graphics';
import { GRAPHIC_ANIMATION_PHASE_VALUES } from '~~/shared/types/graphics';

/**
 * The editor's Graphic Animation Preview controls, shared by every graphics
 * host: which phase, one phase or the lifecycle from it, how fast, whether it
 * loops, and Play and Stop.
 *
 * It describes a run as a plan and nothing more; the host pushes the plan into
 * its preview frame, which runs its own clock. Nothing here writes Screen
 * configuration or touches live state, so it needs no Graphics Authoring Lease
 * and works the same for a read-only observer.
 *
 * There is no playhead and no scrubbing. `run` is a token, not a time: bumping it
 * starts a run over, which is the only control an author has over *when*. A
 * change of what the run plays stops it, rather than silently animating
 * something the author is no longer looking at.
 */
const props = defineProps<{
	/** What a run plays, or null when nothing playable is selected. */
	target: Pick<GraphicsPreviewAnimationPlan, 'graphicId' | 'itemId'> | null;
	/** Why Play is unavailable, shown while there is no target. */
	hint: string;
	/** The host's lifecycle phases, in order; every phase when absent. */
	phases?: readonly GraphicAnimationPhase[];
}>();

const emit = defineEmits<{ 'update:plan': [plan: GraphicsPreviewAnimationPlan | null] }>();

const animationPhaseOptions = computed(() => (props.phases ?? GRAPHIC_ANIMATION_PHASE_VALUES).map(phase => ({
	label: GRAPHIC_ANIMATION_PHASE_LABELS[phase],
	value: phase,
})));

const ANIMATION_SPEED_OPTIONS = [
	{ label: '0.25x', value: 0.25 },
	{ label: '0.5x', value: 0.5 },
	{ label: '1x', value: 1 },
	{ label: '2x', value: 2 },
] as const;

const animationPhase = ref<GraphicAnimationPhase>('enter');
const animationScope = ref<GraphicsPreviewAnimationScope>('phase');
const animationSpeed = ref<number>(1);
const animationLoop = ref(false);
/** Zero means nothing is playing; every start bumps it. */
const animationRun = ref(0);

const plan = computed<GraphicsPreviewAnimationPlan | null>(() => {
	const target = props.target;
	if (animationRun.value === 0 || !target)
		return null;

	return {
		graphicId: target.graphicId,
		...(target.itemId === undefined
			? {}
			: { itemId: target.itemId }),
		scope: animationScope.value,
		phase: animationPhase.value,
		run: animationRun.value,
		speed: animationSpeed.value,
		loop: animationLoop.value,
	};
});

watch(plan, next => emit('update:plan', next), { deep: true });

function playAnimation() {
	animationRun.value += 1;
}

/** Stop and settle at the Graphic Resting State, which is where authoring happens. */
function stopAnimation() {
	animationRun.value = 0;
}

watch(
	() => props.target && `${props.target.graphicId}:${props.target.itemId ?? ''}`,
	(key, previous) => {
		if (key !== previous)
			stopAnimation();
	},
);
</script>

<template>
	<div
		class="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-default/70 p-2"
		data-testid="animation-preview-controls"
	>
		<span class="text-xs font-semibold text-muted">Animation</span>
		<slot />
		<USelectMenu
			:model-value="animationPhase"
			:items="animationPhaseOptions"
			value-key="value"
			size="xs"
			class="w-32"
			aria-label="Preview lifecycle phase"
			data-testid="animation-preview-phase"
			@update:model-value="value => { animationPhase = value }"
		/>
		<UFieldGroup size="xs">
			<UButton
				:color="animationScope === 'phase' ? 'primary' : 'neutral'"
				:variant="animationScope === 'phase' ? 'subtle' : 'outline'"
				:aria-pressed="animationScope === 'phase'"
				data-testid="animation-preview-scope-phase"
				@click="() => { animationScope = 'phase' }"
			>
				Phase
			</UButton>
			<UButton
				:color="animationScope === 'lifecycle' ? 'primary' : 'neutral'"
				:variant="animationScope === 'lifecycle' ? 'subtle' : 'outline'"
				:aria-pressed="animationScope === 'lifecycle'"
				data-testid="animation-preview-scope-lifecycle"
				@click="() => { animationScope = 'lifecycle' }"
			>
				Lifecycle
			</UButton>
		</UFieldGroup>
		<UFieldGroup size="xs">
			<UButton
				v-for="speed in ANIMATION_SPEED_OPTIONS"
				:key="speed.value"
				:color="animationSpeed === speed.value ? 'primary' : 'neutral'"
				:variant="animationSpeed === speed.value ? 'subtle' : 'outline'"
				:aria-pressed="animationSpeed === speed.value"
				:aria-label="`${speed.label} preview speed`"
				:data-testid="`animation-preview-speed-${speed.value}`"
				@click="() => { animationSpeed = speed.value }"
			>
				{{ speed.label }}
			</UButton>
		</UFieldGroup>
		<UFormField label="Loop" size="xs" class="flex items-center gap-2">
			<USwitch v-model="animationLoop" size="sm" data-testid="animation-preview-loop" />
		</UFormField>
		<UButton
			size="xs"
			icon="i-lucide-play"
			:disabled="target === null"
			data-testid="animation-preview-play"
			@click="playAnimation"
		>
			Play
		</UButton>
		<UButton
			size="xs"
			variant="outline"
			icon="i-lucide-square"
			:disabled="animationRun === 0"
			data-testid="animation-preview-stop"
			@click="stopAnimation"
		>
			Stop
		</UButton>
		<p v-if="target === null" class="text-xs text-muted" data-testid="animation-preview-hint">
			{{ hint }}
		</p>
	</div>
</template>
