<script setup lang="ts">
import type { BroadcastGraphicTemplateSummary } from '~~/shared/types/broadcastGraphicTemplate';
import type { GraphicStyleUpdateChange, GraphicStyleUpdateDecision, GraphicStyleUpdateReview } from '~~/shared/types/graphicStyleSet';
import {
	GRAPHIC_STYLE_SLOT_OWNED_KEYS,
	graphicStyleChangedKeys,
	graphicStyleChangeKey,
} from '~~/shared/modules/graphic-style-sets';

/**
 * The reviewed Graphic Style Set update for one Broadcast Graphic Template.
 *
 * This surface is the reason a republished Style Set is never a silent mutation. The
 * change exists here as a list of property groups an author reads, and it does not
 * exist in the template until they apply it — as one atomic new template revision.
 *
 * Each row offers two answers and only two. **Inherit** takes the Style Set's new
 * value. **Keep** preserves what the template renders today by recording it as a new
 * local override, so the properties it names stop following this Style Set. There is
 * deliberately no "decide later, per row": every row moves together, because a
 * template whose inherited references straddled two Style Set revisions could never
 * be reasoned about again.
 *
 * ## Why every row states its values
 *
 * A row's default answer is inherit, and inheriting is not always the harmless one.
 * `recaptureGraphicStyleOverrides` is the identity on a slot that is not in step with
 * the published entries — correctly, because a difference derivable from the
 * resolution there is the Style Set's own pending change rather than the author's
 * deviation — so an author edit made to such a slot between a republish and its review
 * records no override and lives inline. Applying with the default discards it, while
 * the identical edit made in step would have been preserved.
 *
 * Those slots are exactly the ones this panel lists, which is what makes the values
 * below the whole of the defence: #198 narrowed the unrecorded window to the rows an
 * author is looking at, and the paragraph above says so rather than promising more.
 *
 * Without the values, the two rows are indistinguishable: owner, slot and entry name
 * are the same whether the row holds the author's own work or nothing but the Style
 * Set's change. So each row names, property by property, what it would move from and
 * to. An author who recognises their own value has been told what inheriting costs;
 * one who does not is looking at a pure Style Set change and can take it (#162).
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

/**
 * One property of a change, as the author reads it: what it is now, and what the
 * Style Set would make it.
 */
interface ReviewedProperty {
	key: string;
	current: string;
	next: string;
}

/**
 * A value stated compactly enough to sit on one row.
 *
 * A property group's keys are mostly scalars, and the few that are not — an outline, a
 * focal position, a Graphic Fill's stops — are still small enough to read whole. What
 * matters is that an author recognises their own value, so nothing is elided or
 * rounded; an absent property says so rather than rendering as an empty string.
 */
function reviewedValue(value: unknown): string {
	if (value === undefined || value === null)
		return 'not set';
	if (typeof value === 'object')
		return JSON.stringify(value);
	return String(value);
}

/**
 * The properties one row is actually deciding about.
 *
 * Only the ones that move. A property group carries keys the Style Set and this
 * template already agree on, and listing those would bury the handful an author has to
 * judge. These are also exactly what "Keep mine" records as the author's own, beside
 * any override they already had.
 */
function reviewedProperties(change: GraphicStyleUpdateChange): ReviewedProperty[] {
	const current = (change.current ?? {}) as Record<string, unknown>;
	const next = (change.next ?? {}) as Record<string, unknown>;
	return graphicStyleChangedKeys(change.current, change.next).map(key => ({
		key,
		current: reviewedValue(current[key]),
		next: reviewedValue(next[key]),
	}));
}

/**
 * What answering this row with "Keep mine" actually commits the author to.
 *
 * Said per row because it is not the same commitment on every row. A slot that owns
 * keys records the values above as local overrides and leaves the rest of its property
 * group inheriting — the narrowing #162 asked for, stated where the author decides. A
 * slot that owns none has no partial to deviate in, so keeping it cannot record an
 * override at all: `applyGraphicStyleSet` drops the reference and the property goes
 * local outright. One blanket sentence describing the first would be false about the
 * second, which is the whole reason this is computed rather than written once.
 *
 * "That you have not already pinned" is not a hedge. Keeping records the author's
 * prior overrides beside the values on the row, and a row states only the keys that
 * move — so an author who pinned a font size earlier and is now answering a row about
 * a colour keeps both. Without the clause this would promise that the size carries on
 * inheriting, which it does not (#167).
 */
function keepEffect(change: GraphicStyleUpdateChange): string {
	return GRAPHIC_STYLE_SLOT_OWNED_KEYS[change.slot].length === 0
		? `Keeping this makes it a local value and stops it following “${change.entryName}” at all.`
		: `Keeping pins the values above as your own, so they stop following “${change.entryName}”. `
			+ 'Everything else in this group that you have not already pinned carries on inheriting.';
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
		// The refusal's own sentence where the server wrote one, which for this surface is
		// nearly always the Style Set having been republished or the template revised. Read
		// through `failureSentence` rather than straight off the body, because an unmapped
		// 5xx body here says 'Internal Server Error' — the placeholder this server writes
		// over a fault it did not classify — and quoting that would tell the author their
		// update was refused for a reason nobody wrote (#262). A 5xx the mapper did
		// classify keeps its own words and is quoted like any refusal (#286).
		const refused = failureSentence(caught)
			?? (caught instanceof Error ? caught.message : 'The style update could not be applied');
		// Re-read first, because a refusal is usually the Style Set having been
		// republished or the template revised — so what the author is looking at is out
		// of date too. The refusal is stated *after* that read, which clears the error it
		// succeeds at, rather than before it and silently wiped.
		await refresh();
		error.value = refused;
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
			<!--
				What this promises has to be true of every row it is shown above, so it names
				the one edit it cannot keep rather than claiming to keep everything (#198).
			-->
			<p class="text-xs text-muted">
				Applying creates one new revision of this template. Your recorded overrides are kept.
				An edit you made to one of the properties below <em>since this Style Set was
					republished</em> is not one of them, so check the values on each row before
				inheriting it. Broadcast Graphics already placed from it are not affected.
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

				<!--
					What this row would move, property by property. The one thing that tells an
					author's own value apart from the Style Set's incoming one — and the only
					reason the default answer can be an informed one.
				-->
				<dl class="mt-1 space-y-0.5">
					<div
						v-for="property in reviewedProperties(change)"
						:key="property.key"
						class="flex flex-wrap items-baseline gap-x-1.5 text-xs"
						data-testid="style-update-value"
					>
						<dt class="font-mono text-muted">
							{{ property.key }}
						</dt>
						<dd class="flex flex-wrap items-baseline gap-x-1.5">
							<span class="line-through opacity-70" data-testid="style-update-value-current">{{ property.current }}</span>
							<span aria-hidden="true" class="text-muted">→</span>
							<span class="font-medium" data-testid="style-update-value-next">{{ property.next }}</span>
						</dd>
					</div>
				</dl>

				<!--
					And what the answer that is not the default would cost. Stated per row,
					because keeping a slot that owns no keys drops the reference rather than
					recording an override.
				-->
				<p class="mt-1 text-xs text-muted" data-testid="style-update-keep-effect">
					{{ keepEffect(change) }}
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
