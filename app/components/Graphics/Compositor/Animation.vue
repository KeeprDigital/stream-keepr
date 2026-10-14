<script setup lang="ts">
import type { GraphicAnimationChannelKey, GraphicAnimationChannels } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GraphicAnimationPhase,
	GraphicAnimationStagger,
	GraphicContainerAnimation,
	GraphicOnScreenAnimationRecipe,
} from '~~/shared/types/graphics';
import type { GraphicStyleSlot } from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleAuthoringContext } from '~/composables/screen/useGraphicStyleSetAuthoring';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	bindGraphicStyleRef,
	recaptureGraphicStyleOverrides,
	unbindGraphicStyleRef,
} from '~~/shared/modules/graphic-style-sets';
import {
	applyBroadcastGraphicAnimationPreset,
	applyGraphicItemAnimationPreset,
	enableBroadcastGraphicAnimationPhase,
	enableGraphicItemAnimationPhase,
	GRAPHIC_ANIMATION_PHASE_LABELS,
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
	GRAPHIC_ANIMATION_PHASE_VALUES,
	GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES,
	MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS,
} from '~~/shared/types/graphics';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';

/**
 * Graphic Animation controls for the current selection: a Broadcast Graphic, or
 * one Graphic Item.
 *
 * Enabling a lifecycle phase is what creates its recipe, and disabling it is what
 * removes it — a newly authored graphic or item has none. A preset writes an
 * ordinary editable recipe and nothing records that it was used. The recipe body
 * itself is the shared Graphic Animation Recipe fields control, the same one a
 * Graphic Animation Recipe preset is edited with; this component owns the phases.
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
	/**
	 * The published Graphic Style Set this composition is linked to, when it is
	 * linked to one. A Graphic Animation Recipe preset is referenced per lifecycle
	 * phase, from the phase's own controls, exactly as every other preset is
	 * referenced from the property control that already edits it.
	 */
	styleSet?: GraphicStyleAuthoringContext;
	/** The Broadcast Graphics canvas, which a top-level owner's slide is measured against. */
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{ 'update:graphics': [graphics: BroadcastGraphicConfig[]] }>();

/** Fail closed: an unstated permission is never permission. */
const canAuthor = computed(() => props.writable === true);

const selection = computed(() => resolveGraphicsSelection(props.graphics, props.selectedTarget));

/**
 * The Graphic Style Set slot one lifecycle phase's recipe is inherited through.
 *
 * The slot vocabulary names the phase, so a preset assigned to enter and the same
 * preset assigned to exit are two independent references to one entry — which is
 * exactly the glossary's rule that a template "assigns presets to lifecycle phases"
 * while item selection, staggering, and choreography stay local.
 */
function styleSlotFor(phase: GraphicAnimationPhase): GraphicStyleSlot {
	return `animation.${phase}` as GraphicStyleSlot;
}

function styleRefFor(phase: GraphicAnimationPhase) {
	const current = selection.value;
	if (current.kind === 'graphic')
		return current.graphic.styleRefs?.[styleSlotFor(phase) as 'animation.enter'];
	if (current.kind === 'item')
		return current.item.styleRefs?.[styleSlotFor(phase)];
	return undefined;
}

/** The owner a reference is written against: null is the Broadcast Graphic itself. */
function styleOwnerId(): string | null | undefined {
	const current = selection.value;
	if (current.kind === 'graphic')
		return null;
	return current.kind === 'item' ? current.item.id : undefined;
}

function bindStyleRef(phase: GraphicAnimationPhase, entryId: string) {
	const current = selection.value;
	const context = props.styleSet;
	const ownerId = styleOwnerId();
	if (!canAuthor.value || ownerId === undefined || !context)
		return;
	if (current.kind !== 'graphic' && current.kind !== 'item')
		return;
	emit('update:graphics', replaceBroadcastGraphic(
		props.graphics,
		bindGraphicStyleRef(current.graphic, ownerId, styleSlotFor(phase), entryId, context.resolution),
	));
}

function unbindStyleRef(phase: GraphicAnimationPhase) {
	const current = selection.value;
	const ownerId = styleOwnerId();
	if (!canAuthor.value || ownerId === undefined)
		return;
	if (current.kind !== 'graphic' && current.kind !== 'item')
		return;
	emit('update:graphics', replaceBroadcastGraphic(
		props.graphics,
		unbindGraphicStyleRef(current.graphic, ownerId, styleSlotFor(phase)),
	));
}

const STAGGER_ORDER_OPTIONS = [
	{ label: 'List order', value: GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES[0] },
	{ label: 'Reverse list order', value: GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES[1] },
];
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

/**
 * The owner's parent, as the renderer resolves it: a Graphic Group for its
 * children, and the canvas for a top-level Graphic Item or a Broadcast Graphic.
 * A fixed slide distance is entered against it in the author's Geometry Unit.
 */
const slideParent = computed(() => {
	const current = selection.value;
	if (current.kind === 'item' && current.group)
		return { width: current.group.width, height: current.group.height, name: 'group' } as const;
	return { width: props.canvasWidth, height: props.canvasHeight, name: 'canvas' } as const;
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
	if (current.kind === 'graphic') {
		const graphics = onGraphic(props.graphics, current.graphic.id);
		const edited = graphics.find(graphic => graphic.id === current.graphic.id);
		emit('update:graphics', edited
			? graphics.map(graphic => graphic.id === edited.id ? withRecapturedStyleOverrides(edited) : graphic)
			: graphics);
	}
	else if (current.kind === 'item') {
		emit('update:graphics', replaceBroadcastGraphic(
			props.graphics,
			withRecapturedStyleOverrides(onItem(current.graphic, current.item.id)),
		));
	}
}

/**
 * One edited Broadcast Graphic, with its Graphic Style Set overrides brought back
 * into line with what it now holds.
 *
 * The same funnel the inspector's property controls go through, for the same reason:
 * these controls write recipe *values*, and an edit to a phase whose recipe is
 * inherited is a deviation by definition. Deriving it here is what makes it the
 * explicit property-level override the glossary requires — without it, the author's
 * change would be silently reverted by the next applied Style Set update.
 *
 * The composition as `props.graphics` still holds it is what says which slots had a
 * pending Style Set change before this edit — the edited copy cannot, since the edit
 * itself is a difference from the entry (#198).
 */
function withRecapturedStyleOverrides(graphic: BroadcastGraphicConfig): BroadcastGraphicConfig {
	const context = props.styleSet;
	const stored = props.graphics.find(candidate => candidate.id === graphic.id);
	return context && stored
		? recaptureGraphicStyleOverrides(graphic, context.resolution, context.publishedRevision, stored)
		: graphic;
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
	patch: Partial<GraphicAnimationChannels[K]> | null,
) {
	apply(
		(graphics, graphicId) => patchBroadcastGraphicAnimationChannel(graphics, graphicId, phase, channel, patch),
		(graphic, itemId) => patchGraphicItemAnimationChannel(graphic, itemId, phase, channel, patch),
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
				<GraphicsCompositorStyleRef
					:style-slot="`animation.${phase}`"
					:label="`${GRAPHIC_ANIMATION_PHASE_LABELS[phase]} recipe`"
					:entries="styleSet?.entries"
					:current="styleRefFor(phase)"
					:writable="canAuthor"
					@bind="entryId => bindStyleRef(phase, entryId)"
					@unbind="unbindStyleRef(phase)"
				/>

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

				<GraphicsAnimationRecipeFields
					:recipe="recipeOf(phase)!"
					:cycling="phase === 'on-screen'"
					:disabled="!canAuthor"
					:slide-parent="slideParent"
					:test-id-prefix="`animation-${phase}`"
					@update="patch => updateRecipe(phase, patch)"
					@channel="(channel, patch) => updateChannel(phase, channel, patch)"
				/>
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
