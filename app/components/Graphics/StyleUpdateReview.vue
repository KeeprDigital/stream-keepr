<script setup lang="ts">
import type { BroadcastGraphicTemplateSummary } from '~~/shared/types/broadcastGraphicTemplate';
import type { GraphicStyleUpdateDecision, GraphicStyleUpdateReview } from '~~/shared/types/graphicStyleSet';
import { graphicStyleChangeKey } from '~~/shared/modules/graphic-style-sets';

/**
 * The reviewed Graphic Style Set update for one Broadcast Graphic Template.
 *
 * This surface is the reason a republished Style Set is never a silent mutation. The
 * change exists here as a list of property groups an author reads, and it does not
 * exist in the template until they apply it — as one atomic new template revision.
 *
 * Each row offers two answers and only two. **Inherit** takes the Style Set's new
 * value. **Keep** preserves what the template renders today by recording it as a new
 * local override, so it will not move on this republish or any later one. There is
 * deliberately no "decide later, per row": every row moves together, because a
 * template whose inherited references straddled two Style Set revisions could never
 * be reasoned about again.
 */
const props = defineProps<{
	template: BroadcastGraphicTemplateSummary;
	writable?: boolean;
}>();

const emit = defineEmits<{ applied: [] }>();

const repository = useGraphicStyleSetRepository();

const review = ref<GraphicStyleUpdateReview | null>(null);
const decisions = ref<Record<string, GraphicStyleUpdateDecision>>({});
const busy = ref(false);
const error = ref<string | null>(null);
const expanded = ref(false);

const canAuthor = computed(() => props.writable === true);
const available = computed(() => review.value?.available === true);

const SLOT_LABELS: Record<string, string> = {
	'typography': 'Typography',
	'surfaceStyle': 'Graphic Surface Style',
	'surfaceStyle.fill': 'Graphic Fill',
	'defaultChildSurfaceStyle': 'Child style default',
	'boxSurfaceStyle': 'Game win box',
	'wonBoxSurfaceStyle': 'Won game win box',
	'geometry': 'Shape Geometry',
	'clipGeometry': 'Clipping geometry',
	'boxGeometry': 'Win box geometry',
	'media': 'Media treatment',
	'animation.enter': 'Enter animation',
	'animation.on-screen': 'On-screen animation',
	'animation.update': 'Update animation',
	'animation.exit': 'Exit animation',
};

async function refresh() {
	busy.value = true;
	try {
		review.value = await repository.reviewTemplateUpdate(props.template.id);
		decisions.value = {};
		error.value = null;
	}
	catch (caught) {
		review.value = null;
		error.value = caught instanceof Error ? caught.message : 'The style update could not be read';
	}
	finally {
		busy.value = false;
	}
}

function decisionFor(itemId: string | null, slot: string): GraphicStyleUpdateDecision {
	return decisions.value[graphicStyleChangeKey(itemId, slot as never)] ?? 'inherit';
}

function decide(itemId: string | null, slot: string, decision: GraphicStyleUpdateDecision) {
	decisions.value = {
		...decisions.value,
		[graphicStyleChangeKey(itemId, slot as never)]: decision,
	};
}

async function apply() {
	const reviewed = review.value?.styleSet;
	if (!canAuthor.value || !available.value || !reviewed)
		return;
	busy.value = true;
	try {
		// The Style Set revision this review was read at, so a republish in between is
		// refused rather than applied under decisions the author never made about it.
		await repository.applyTemplateUpdate(props.template.id, {
			revision: props.template.revision,
			styleSetRevision: reviewed.publishedRevision,
			decisions: decisions.value,
		});
		error.value = null;
		expanded.value = false;
		emit('applied');
	}
	catch (caught) {
		const data = (caught as { data?: { message?: string } })?.data;
		error.value = data?.message ?? (caught instanceof Error ? caught.message : 'The style update could not be applied');
		await refresh();
	}
	finally {
		busy.value = false;
	}
}

watch(() => [props.template.id, props.template.revision], () => void refresh(), { immediate: true });
</script>

<template>
	<div v-if="review?.styleSet" class="mt-2" :data-testid="`style-update-${template.id}`">
		<div class="flex items-center gap-1.5">
			<UBadge
				:color="available ? 'warning' : 'neutral'"
				variant="subtle"
				size="sm"
				data-testid="style-update-state"
			>
				{{ review.styleSet.name }}
				· {{ available ? 'update available' : `revision ${review.styleSet.linkedRevision}` }}
			</UBadge>
			<UButton
				v-if="available"
				size="xs"
				variant="subtle"
				icon="i-lucide-list-checks"
				:disabled="busy"
				data-testid="style-update-review"
				@click="expanded = !expanded"
			>
				Review
			</UButton>
		</div>

		<UAlert
			v-if="error"
			class="mt-2"
			color="error"
			variant="soft"
			icon="i-lucide-triangle-alert"
			title="Style update failed"
			:description="error"
			data-testid="style-update-error"
		/>

		<div
			v-if="expanded && available"
			class="mt-2 rounded-md border border-default/60 p-2"
			data-testid="style-update-changes"
		>
			<p class="text-xs text-muted">
				Applying creates one new revision of this template. Local overrides are kept.
				Broadcast Graphics already placed from it are not affected.
			</p>

			<div
				v-for="change in review.changes"
				:key="`${change.ownerItemId ?? ''}-${change.slot}`"
				class="mt-2 border-t border-default/50 pt-2"
			>
				<p class="text-xs font-medium">
					{{ change.ownerLabel }} · {{ SLOT_LABELS[change.slot] ?? change.slot }}
				</p>
				<p class="text-xs text-muted">
					from “{{ change.entryName }}”
				</p>
				<div class="mt-1 flex gap-1.5">
					<UButton
						size="xs"
						:variant="decisionFor(change.ownerItemId, change.slot) === 'inherit' ? 'subtle' : 'ghost'"
						:disabled="!canAuthor"
						data-testid="style-update-inherit"
						@click="decide(change.ownerItemId, change.slot, 'inherit')"
					>
						Take the new style
					</UButton>
					<UButton
						size="xs"
						color="neutral"
						:variant="decisionFor(change.ownerItemId, change.slot) === 'keep-as-override' ? 'subtle' : 'ghost'"
						:disabled="!canAuthor"
						data-testid="style-update-keep"
						@click="decide(change.ownerItemId, change.slot, 'keep-as-override')"
					>
						Keep mine
					</UButton>
				</div>
			</div>

			<UButton
				class="mt-3"
				size="xs"
				icon="i-lucide-check"
				:disabled="busy || !canAuthor"
				data-testid="style-update-apply"
				@click="apply"
			>
				Apply as a new revision
			</UButton>
		</div>
	</div>
</template>
