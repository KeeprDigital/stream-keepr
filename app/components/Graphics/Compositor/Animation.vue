<script setup lang="ts">
import type { GraphicAnimationChannelKey } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GraphicAnimationPhase,
	GraphicAnimationStagger,
	GraphicContainerAnimation,
	GraphicOnScreenAnimationRecipe,
} from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	applyBroadcastGraphicAnimationPreset,
	applyGraphicItemAnimationPreset,
	enableBroadcastGraphicAnimationPhase,
	enableGraphicItemAnimationPhase,
	GRAPHIC_ANIMATION_ORIGINS,
	GRAPHIC_ANIMATION_PHASE_LABELS,
	GRAPHIC_SLIDE_DIRECTIONS,
	graphicAnimationPresetsForPhase,
	patchBroadcastGraphicAnimationChannel,
	patchBroadcastGraphicAnimationRecipe,
	patchBroadcastGraphicAnimationStagger,
	patchGraphicItemAnimationChannel,
	patchGraphicItemAnimationRecipe,
	patchGraphicItemAnimationStagger,
	replaceBroadcastGraphic,
	setBroadcastGraphicAnimationRecipe,
	setGraphicItemAnimationRecipe,
	toggleBroadcastGraphicStaggerMember,
	toggleGraphicItemStaggerMember,
} from '~~/shared/modules/graphics';
import {
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_PHASE_VALUES,
	GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES,
	GRAPHIC_REVEAL_EDGE_VALUES,
	GRAPHIC_SLIDE_DISTANCE_MODE_VALUES,
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_PAUSE_MS,
	MAX_GRAPHIC_ANIMATION_REPEAT,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS,
	MAX_GRAPHIC_SLIDE_DISTANCE_PX,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_REPEAT,
} from '~~/shared/types/graphics';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';

/**
 * Graphic Animation controls for the current selection: a Broadcast Graphic, or
 * one Graphic Item.
 *
 * Enabling a lifecycle phase is what creates its recipe, and disabling it is what
 * removes it — a newly authored graphic or item has none. A preset writes an
 * ordinary editable recipe and nothing records that it was used.
 *
 * Every edit goes through the shared authoring merges, so changing one channel
 * field never drops the channel's siblings and changing one channel never drops
 * the recipe's other channels. Nothing here touches the item's geometry or style:
 * a recipe moves relative to the Graphic Resting State and never changes it.
 *
 * Only a container — a Broadcast Graphic or a Graphic Group — offers a stagger,
 * because only a container has direct Graphic Items to order.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	/** Whether this session holds the artifact's Graphics Authoring Lease. */
	writable?: boolean;
}>();

const emit = defineEmits<{ 'update:graphics': [graphics: BroadcastGraphicConfig[]] }>();

/** Fail closed: an unstated permission is never permission. */
const canAuthor = computed(() => props.writable === true);

const selection = computed(() => resolveGraphicsSelection(props.graphics, props.selectedTarget));

const EASING_OPTIONS = GRAPHIC_ANIMATION_EASING_VALUES.map(value => ({ label: value, value }));
const ORIGIN_OPTIONS = GRAPHIC_ANIMATION_ORIGINS.map(origin => ({ label: origin.label, value: origin.value }));
const DIRECTION_OPTIONS = GRAPHIC_SLIDE_DIRECTIONS.map(entry => ({ label: entry.label, value: entry.value }));
const DISTANCE_MODE_OPTIONS = [
	{ label: 'Fixed', value: GRAPHIC_SLIDE_DISTANCE_MODE_VALUES[0] },
	{ label: 'Clear parent', value: GRAPHIC_SLIDE_DISTANCE_MODE_VALUES[1] },
];
const REVEAL_EDGE_OPTIONS = GRAPHIC_REVEAL_EDGE_VALUES.map(value => ({ label: value, value }));
const STAGGER_ORDER_OPTIONS = [
	{ label: 'List order', value: GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES[0] },
	{ label: 'Reverse list order', value: GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES[1] },
];
const CHANNEL_KEYS: readonly GraphicAnimationChannelKey[] = ['fade', 'slide', 'scale', 'reveal'];
const CHANNEL_LABELS: Record<GraphicAnimationChannelKey, string> = {
	fade: 'Fade',
	slide: 'Slide',
	scale: 'Scale',
	reveal: 'Reveal',
};

const PHASES = GRAPHIC_ANIMATION_PHASE_VALUES;

/**
 * The animation of whatever is selected, or undefined when nothing owns one.
 *
 * Read as a container's animation because a Broadcast Graphic and a Graphic Group
 * are containers; a Text or Shape Graphic Item simply never has a stagger, and the
 * controls that would edit one are not rendered for it.
 */
const animation = computed<GraphicContainerAnimation | undefined>(() => {
	const current = selection.value;
	if (current.kind === 'graphic')
		return current.graphic.animation;
	if (current.kind === 'item')
		return current.item.animation;
	return undefined;
});

/** A Broadcast Graphic and a Graphic Group order their own direct Graphic Items. */
const staggerMembers = computed(() => {
	const current = selection.value;
	if (current.kind === 'graphic')
		return current.graphic.items.map(item => ({ id: item.id, label: item.label }));
	if (current.kind === 'item' && current.item.type === 'group')
		return current.item.children.map(child => ({ id: child.id, label: child.label }));
	return [];
});

const ownerLabel = computed(() => {
	const current = selection.value;
	if (current.kind === 'graphic')
		return current.graphic.name;
	if (current.kind === 'item')
		return current.item.label;
	return '';
});

/**
 * One edit, aimed at whichever owner is selected.
 *
 * A Broadcast Graphic's animation lives on the stack entry and an item's inside
 * its graphic, so the two take different helpers; everything above this line is
 * written once for both.
 */
function apply(
	onGraphic: (graphics: readonly BroadcastGraphicConfig[], graphicId: string) => BroadcastGraphicConfig[],
	onItem: (graphic: BroadcastGraphicConfig, itemId: string) => BroadcastGraphicConfig,
) {
	const current = selection.value;
	if (!canAuthor.value)
		return;
	if (current.kind === 'graphic')
		emit('update:graphics', onGraphic(props.graphics, current.graphic.id));
	else if (current.kind === 'item')
		emit('update:graphics', replaceBroadcastGraphic(props.graphics, onItem(current.graphic, current.item.id)));
}

function setPhaseEnabled(phase: GraphicAnimationPhase, enabled: boolean) {
	if (enabled) {
		apply(
			(graphics, graphicId) => enableBroadcastGraphicAnimationPhase(graphics, graphicId, phase),
			(graphic, itemId) => enableGraphicItemAnimationPhase(graphic, itemId, phase),
		);
		return;
	}

	apply(
		(graphics, graphicId) => setBroadcastGraphicAnimationRecipe(graphics, graphicId, phase, null),
		(graphic, itemId) => setGraphicItemAnimationRecipe(graphic, itemId, phase, null),
	);
}

function updateRecipe(phase: GraphicAnimationPhase, patch: Partial<GraphicOnScreenAnimationRecipe>) {
	apply(
		(graphics, graphicId) => patchBroadcastGraphicAnimationRecipe(graphics, graphicId, phase, patch),
		(graphic, itemId) => patchGraphicItemAnimationRecipe(graphic, itemId, phase, patch),
	);
}

function updateChannel<K extends GraphicAnimationChannelKey>(
	phase: GraphicAnimationPhase,
	channel: K,
	patch: Record<string, unknown> | null,
) {
	apply(
		(graphics, graphicId) => patchBroadcastGraphicAnimationChannel(graphics, graphicId, phase, channel, patch as never),
		(graphic, itemId) => patchGraphicItemAnimationChannel(graphic, itemId, phase, channel, patch as never),
	);
}

function applyPreset(phase: GraphicAnimationPhase, presetId: string) {
	apply(
		(graphics, graphicId) => applyBroadcastGraphicAnimationPreset(graphics, graphicId, phase, presetId),
		(graphic, itemId) => applyGraphicItemAnimationPreset(graphic, itemId, phase, presetId),
	);
}

function updateStagger(phase: GraphicAnimationPhase, patch: Partial<GraphicAnimationStagger> | null) {
	apply(
		(graphics, graphicId) => patchBroadcastGraphicAnimationStagger(graphics, graphicId, phase, patch),
		(graphic, itemId) => patchGraphicItemAnimationStagger(graphic, itemId, phase, patch),
	);
}

function toggleStaggerMember(phase: GraphicAnimationPhase, memberId: string, selected: boolean) {
	apply(
		(graphics, graphicId) => toggleBroadcastGraphicStaggerMember(graphics, graphicId, phase, memberId, selected),
		(graphic, itemId) => toggleGraphicItemStaggerMember(graphic, itemId, phase, memberId, selected),
	);
}

function presetOptions(phase: GraphicAnimationPhase) {
	return graphicAnimationPresetsForPhase(phase).map(preset => ({ label: preset.label, value: preset.id }));
}

function recipeOf(phase: GraphicAnimationPhase) {
	return animation.value?.[phase];
}

function staggerOf(phase: GraphicAnimationPhase) {
	return animation.value?.stagger?.[phase];
}

function onScreenRecipeOf() {
	return animation.value?.['on-screen'];
}
</script>

<template>
	<fieldset
		v-if="selection.kind === 'graphic' || selection.kind === 'item'"
		class="min-w-0 space-y-3 border-t border-default/70 pt-3"
		:disabled="!canAuthor"
		data-testid="graphic-animation-editor"
	>
		<div class="flex items-center gap-2">
			<UIcon name="i-lucide-wand-sparkles" class="size-4 shrink-0 text-muted" />
			<p class="text-sm font-semibold">
				Animation
			</p>
			<UBadge size="xs" variant="soft">
				{{ ownerLabel }}
			</UBadge>
		</div>

		<div
			v-for="phase in PHASES"
			:key="phase"
			class="rounded-md border border-default/60 p-2"
			:data-animation-phase="phase"
		>
			<div class="flex items-center justify-between gap-2">
				<p class="text-xs font-semibold">
					{{ GRAPHIC_ANIMATION_PHASE_LABELS[phase] }}
				</p>
				<USwitch
					:model-value="recipeOf(phase) !== undefined"
					size="sm"
					:aria-label="`${GRAPHIC_ANIMATION_PHASE_LABELS[phase]} animation`"
					:data-testid="`animation-${phase}-enabled`"
					@update:model-value="value => setPhaseEnabled(phase, value === true)"
				/>
			</div>

			<div v-if="recipeOf(phase)" class="mt-2 space-y-2">
				<UFormField label="Preset" size="xs">
					<USelectMenu
						:items="presetOptions(phase)"
						value-key="value"
						size="xs"
						class="w-full"
						placeholder="Apply a preset"
						:data-testid="`animation-${phase}-preset`"
						@update:model-value="value => applyPreset(phase, String(value))"
					/>
				</UFormField>

				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Duration (ms)" size="xs">
						<UInputNumber
							:model-value="recipeOf(phase)!.duration"
							:min="MIN_GRAPHIC_ANIMATION_DURATION_MS"
							:max="MAX_GRAPHIC_ANIMATION_DURATION_MS"
							size="xs"
							:data-testid="`animation-${phase}-duration`"
							@update:model-value="value => updateRecipe(phase, { duration: Number(value ?? 0) })"
						/>
					</UFormField>
					<UFormField label="Delay (ms)" size="xs">
						<UInputNumber
							:model-value="recipeOf(phase)!.delay"
							:min="0"
							:max="MAX_GRAPHIC_ANIMATION_DELAY_MS"
							size="xs"
							:data-testid="`animation-${phase}-delay`"
							@update:model-value="value => updateRecipe(phase, { delay: Number(value ?? 0) })"
						/>
					</UFormField>
				</div>

				<UFormField label="Easing" size="xs">
					<USelectMenu
						:model-value="recipeOf(phase)!.easing"
						:items="EASING_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:data-testid="`animation-${phase}-easing`"
						@update:model-value="value => updateRecipe(phase, { easing: value })"
					/>
				</UFormField>

				<template v-if="phase === 'on-screen'">
					<div class="grid grid-cols-2 gap-2">
						<UFormField label="Pause (ms)" size="xs">
							<UInputNumber
								:model-value="onScreenRecipeOf()?.pause ?? 0"
								:min="0"
								:max="MAX_GRAPHIC_ANIMATION_PAUSE_MS"
								size="xs"
								data-testid="animation-on-screen-pause"
								@update:model-value="value => updateRecipe(phase, { pause: Number(value ?? 0) })"
							/>
						</UFormField>
						<UFormField label="Repeat" size="xs">
							<UInputNumber
								:model-value="onScreenRecipeOf()?.repeat === 'indefinite' ? undefined : Number(onScreenRecipeOf()?.repeat ?? 1)"
								:min="MIN_GRAPHIC_ANIMATION_REPEAT"
								:max="MAX_GRAPHIC_ANIMATION_REPEAT"
								:disabled="onScreenRecipeOf()?.repeat === 'indefinite'"
								size="xs"
								data-testid="animation-on-screen-repeat"
								@update:model-value="value => updateRecipe(phase, { repeat: Number(value ?? 1) })"
							/>
						</UFormField>
					</div>
					<UFormField label="Repeat indefinitely" size="xs" class="flex items-center gap-2">
						<USwitch
							:model-value="onScreenRecipeOf()?.repeat === 'indefinite'"
							size="sm"
							data-testid="animation-on-screen-indefinite"
							@update:model-value="value => updateRecipe(phase, { repeat: value === true ? 'indefinite' : 1 })"
						/>
					</UFormField>
				</template>

				<div
					v-for="channel in CHANNEL_KEYS"
					:key="channel"
					class="rounded border border-default/50 p-2"
				>
					<div class="flex items-center justify-between gap-2">
						<p class="text-xs">
							{{ CHANNEL_LABELS[channel] }}
						</p>
						<USwitch
							:model-value="recipeOf(phase)![channel] !== undefined"
							size="sm"
							:aria-label="`${CHANNEL_LABELS[channel]} channel`"
							:data-testid="`animation-${phase}-${channel}-enabled`"
							@update:model-value="value => updateChannel(phase, channel, value === true ? {} : null)"
						/>
					</div>

					<div v-if="channel === 'fade' && recipeOf(phase)!.fade" class="mt-2">
						<UFormField label="Opacity at excursion" size="xs">
							<UInputNumber
								:model-value="recipeOf(phase)!.fade!.opacity"
								:min="0"
								:max="1"
								:step="0.05"
								size="xs"
								:data-testid="`animation-${phase}-fade-opacity`"
								@update:model-value="value => updateChannel(phase, 'fade', { opacity: Number(value ?? 0) })"
							/>
						</UFormField>
					</div>

					<div v-if="channel === 'slide' && recipeOf(phase)!.slide" class="mt-2 space-y-2">
						<UFormField label="Direction" size="xs">
							<USelectMenu
								:model-value="recipeOf(phase)!.slide!.direction"
								:items="DIRECTION_OPTIONS"
								value-key="value"
								size="xs"
								class="w-full"
								:data-testid="`animation-${phase}-slide-direction`"
								@update:model-value="value => updateChannel(phase, 'slide', { direction: value })"
							/>
						</UFormField>
						<UFormField label="Distance" size="xs">
							<USelectMenu
								:model-value="recipeOf(phase)!.slide!.distanceMode"
								:items="DISTANCE_MODE_OPTIONS"
								value-key="value"
								size="xs"
								class="w-full"
								:data-testid="`animation-${phase}-slide-mode`"
								@update:model-value="value => updateChannel(phase, 'slide', { distanceMode: value })"
							/>
						</UFormField>
						<UFormField
							v-if="recipeOf(phase)!.slide!.distanceMode === 'fixed'"
							label="Distance (px)"
							size="xs"
						>
							<UInputNumber
								:model-value="recipeOf(phase)!.slide!.distance"
								:min="0"
								:max="MAX_GRAPHIC_SLIDE_DISTANCE_PX"
								size="xs"
								:data-testid="`animation-${phase}-slide-distance`"
								@update:model-value="value => updateChannel(phase, 'slide', { distance: Number(value ?? 0) })"
							/>
						</UFormField>
					</div>

					<div v-if="channel === 'scale' && recipeOf(phase)!.scale" class="mt-2 space-y-2">
						<UFormField label="Factor" size="xs">
							<UInputNumber
								:model-value="recipeOf(phase)!.scale!.factor"
								:min="0"
								:max="MAX_GRAPHIC_ANIMATION_SCALE"
								:step="0.05"
								size="xs"
								:data-testid="`animation-${phase}-scale-factor`"
								@update:model-value="value => updateChannel(phase, 'scale', { factor: Number(value ?? 0) })"
							/>
						</UFormField>
						<UFormField label="Origin" size="xs">
							<USelectMenu
								:model-value="recipeOf(phase)!.scale!.origin"
								:items="ORIGIN_OPTIONS"
								value-key="value"
								size="xs"
								class="w-full"
								:data-testid="`animation-${phase}-scale-origin`"
								@update:model-value="value => updateChannel(phase, 'scale', { origin: value })"
							/>
						</UFormField>
					</div>

					<div v-if="channel === 'reveal' && recipeOf(phase)!.reveal" class="mt-2">
						<UFormField label="From edge" size="xs">
							<USelectMenu
								:model-value="recipeOf(phase)!.reveal!.edge"
								:items="REVEAL_EDGE_OPTIONS"
								value-key="value"
								size="xs"
								class="w-full"
								:data-testid="`animation-${phase}-reveal-edge`"
								@update:model-value="value => updateChannel(phase, 'reveal', { edge: value })"
							/>
						</UFormField>
					</div>
				</div>
			</div>

			<!--
				A container may stagger its direct Graphic Items whether or not it has a
				recipe of its own: ordering its items is a separate authoring act from
				moving itself.
			-->
			<div v-if="staggerMembers.length > 0" class="mt-2 rounded border border-default/50 p-2">
				<div class="flex items-center justify-between gap-2">
					<p class="text-xs">
						Stagger
					</p>
					<USwitch
						:model-value="staggerOf(phase) !== undefined"
						size="sm"
						:aria-label="`${GRAPHIC_ANIMATION_PHASE_LABELS[phase]} stagger`"
						:data-testid="`animation-${phase}-stagger-enabled`"
						@update:model-value="value => updateStagger(phase, value === true ? {} : null)"
					/>
				</div>

				<div v-if="staggerOf(phase)" class="mt-2 space-y-2">
					<UFormField label="Order" size="xs">
						<USelectMenu
							:model-value="staggerOf(phase)!.order"
							:items="STAGGER_ORDER_OPTIONS"
							value-key="value"
							size="xs"
							class="w-full"
							:data-testid="`animation-${phase}-stagger-order`"
							@update:model-value="value => updateStagger(phase, { order: value })"
						/>
					</UFormField>
					<UFormField label="Step (ms)" size="xs">
						<UInputNumber
							:model-value="staggerOf(phase)!.step"
							:min="0"
							:max="MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS"
							size="xs"
							:data-testid="`animation-${phase}-stagger-step`"
							@update:model-value="value => updateStagger(phase, { step: Number(value ?? 0) })"
						/>
					</UFormField>
					<div class="space-y-1">
						<UFormField
							v-for="member in staggerMembers"
							:key="member.id"
							:label="member.label"
							size="xs"
							class="flex items-center gap-2"
						>
							<USwitch
								:model-value="staggerOf(phase)!.itemIds.includes(member.id)"
								size="sm"
								:aria-label="`Stagger ${member.label}`"
								:data-testid="`animation-${phase}-stagger-member-${member.id}`"
								@update:model-value="value => toggleStaggerMember(phase, member.id, value === true)"
							/>
						</UFormField>
					</div>
				</div>
			</div>
		</div>
	</fieldset>
</template>
