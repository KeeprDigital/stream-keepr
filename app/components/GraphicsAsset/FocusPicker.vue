<script setup lang="ts">
import type {
	GraphicAsset,
	GraphicAssetReference,
	GraphicAssetReferenceStatus,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsVideoTarget } from '~~/shared/utils/graphicAssetTargetCompatibility';
import type { GraphicAssetPickerScope } from '~/composables/useGraphicAssetPickerScope';
import { graphicAssetTargetCompatibility } from '~~/shared/utils/graphicAssetTargetCompatibility';
import { graphicAssetReferenceStatusOrUnavailable } from '~/utils/graphicAssetReferenceStatus';
import { createGuardedSequence } from '~/utils/guardedSequence';

const props = withDefaults(defineProps<{
	modelValue?: GraphicAssetReference;
	eventId: number;
	fieldLabel: string;
	assetKind?: GraphicAsset['kind'] | GraphicAsset['kind'][];
	/**
	 * The target this host writes its references with, which decides what may be
	 * pinned here at all. A blocked revision is not offered.
	 */
	videoTarget?: GraphicsVideoTarget;
	/**
	 * The Open Screen Output Engines, when the host knows them.
	 *
	 * Reports rather than gates, which is what keeps it apart from `videoTarget`: a
	 * revision one open output cannot play costs that output that revision and nothing
	 * else (#98), and the operator may well be choosing for the Chromium program
	 * output. Stated before the choice, never taken instead of it.
	 */
	openOutputTargets?: GraphicsVideoTarget[];
	/** Withhold every affordance, without hiding what is already pinned. */
	disabled?: boolean;
	/**
	 * Whether to offer Clear beside Choose.
	 *
	 * A host that shows and clears the pinned reference itself passes `false`, so it
	 * can still hand the picker the reference — and get its Missing, Unavailable, and
	 * retry reporting on it — without offering the operator two Clears.
	 */
	clearable?: boolean;
}>(), {
	assetKind: 'image',
	videoTarget: 'other',
	openOutputTargets: () => [],
	disabled: false,
	clearable: true,
});

const emit = defineEmits<{
	'update:modelValue': [reference: GraphicAssetReference | undefined];
	'select': [asset: GraphicAsset, reference: GraphicAssetReference];
}>();

const open = ref(false);
const search = ref('');
const referenceStatus = ref<GraphicAssetReferenceStatus>();
const referenceStatusFlights = createGuardedSequence();
const {
	signal: referenceStatusRefreshSignal,
	requestRefresh: retryReferenceStatus,
} = useGraphicAssetReferenceStatusRefresh();
const {
	data: assets,
	status,
	error,
} = useFetch<GraphicAsset[]>('/api/graphics-assets', {
	query: computed(() => ({ search: search.value })),
	default: () => [],
});

/**
 * What a failed library listing says to the author who opened the picker.
 *
 * `useFetch` hands its `error` on as the failure the request produced, whose own
 * `message` is the transport's line — rendering it put '[GET] "/api/graphics-assets":
 * 403 Forbidden' where the route had written 'An authenticated graphics author session
 * is required'. `failureSentence` owns which failures may be quoted, and since #286 that
 * includes the 5xx families whose prose the server preserves through sanitizing: an
 * unavailable Graphics Asset Library is exactly the answer this surface must not turn
 * back into a status line. The transport's line stays as the fallback, because a
 * genuinely sanitized 5xx has nothing else honest to show (#271).
 */
const loadFailureMessage = computed(() => reportedMessage(error.value));

const acceptedKinds = computed<GraphicAsset['kind'][]>(
	() => Array.isArray(props.assetKind) ? props.assetKind : [props.assetKind],
);

/* ────────────────────────────────────────────────
 * Scope
 * ──────────────────────────────────────────────── */

const { chosen: chosenScope, choose: chooseScope } = useGraphicAssetPickerScope();

/**
 * Widened for this opening alone, because 'This Event' had nothing in it.
 *
 * Separate from the author's own choice so that an automatic widening is never
 * mistaken for a preference: it lasts until the modal closes and is reconsidered
 * on the next opening, when the Event may well have adopted something.
 */
const widenedForThisOpening = ref(false);
const scope = computed<GraphicAssetPickerScope>(() =>
	chosenScope.value ?? (widenedForThisOpening.value ? 'library' : 'event'),
);

const libraryAssets = computed(() => (assets.value ?? []).filter(asset =>
	acceptedKinds.value.includes(asset.kind),
));
const eventAssets = computed(() => libraryAssets.value.filter(asset =>
	asset.eventIds.includes(props.eventId),
));
const visibleAssets = computed(() => scope.value === 'event' ? eventAssets.value : libraryAssets.value);

/** How many the Event scope is holding back — the number that says 'not gone'. */
const hiddenByScope = computed(() =>
	scope.value === 'event' ? libraryAssets.value.length - eventAssets.value.length : 0,
);

/**
 * Never open on an empty scope.
 *
 * An Event adopts assets by being pointed at them, so 'This Event' is empty on
 * every Event until the first one is pinned — and a picker that opens there
 * shows an empty grid with no sign that the library behind it is full.
 *
 * Only while the search box is empty: once an author is searching, an Event
 * scope with no matches is an answer about the search, and moving the ground
 * under them mid-keystroke would be worse than the empty result.
 */
watch(
	[open, () => eventAssets.value.length, () => libraryAssets.value.length],
	() => {
		if (!open.value) {
			widenedForThisOpening.value = false;
			return;
		}
		if (chosenScope.value !== null || search.value.length > 0)
			return;
		if (eventAssets.value.length === 0 && libraryAssets.value.length > 0)
			widenedForThisOpening.value = true;
	},
);
const selectedAsset = computed(() => (assets.value ?? []).find(asset =>
	acceptedKinds.value.includes(asset.kind)
	&& asset.id === props.modelValue?.assetId
	&& asset.revisionId === props.modelValue?.revisionId,
));
function assetCompatibility(asset: GraphicAsset) {
	return graphicAssetTargetCompatibility(asset.facts, props.videoTarget);
}

/** The engines an operator would name, rather than the tokens the code matches on. */
const VIDEO_TARGET_LABELS: Record<GraphicsVideoTarget, string> = {
	chromium: 'Chromium',
	safari: 'Safari',
	other: 'a non-Chromium engine',
};

/**
 * Why this revision cannot be pinned here, in the terms of what actually refused it.
 *
 * Two different refusals wear the same `blocked` outcome. One is about this host's
 * target: a VP9-alpha clip is Chromium-only, so pinning it against any other target
 * would write a reference that target could never resolve. The other is about the
 * revision itself — a transparent clip whose facts do not confirm Chromium playback is
 * one no engine is known to play, and it is refused for the Chromium target too.
 *
 * Asking the gate about the Chromium target is what separates them, rather than
 * restating its conditions here: Chromium is the only target that can accept a
 * transparent clip, so a revision blocked even for it is blocked everywhere. Naming a
 * target for that one would send the operator to change a setting that cannot help.
 */
function blockedReason(asset: GraphicAsset): string {
	return graphicAssetTargetCompatibility(asset.facts, 'chromium').outcome === 'blocked'
		? 'Blocked · no engine plays this revision'
		: `Blocked for ${VIDEO_TARGET_LABELS[props.videoTarget]} target`;
}

/** The engines open right now that cannot play this exact revision. */
function blockedOpenOutputs(asset: GraphicAsset): string[] {
	return props.openOutputTargets
		.filter(target => graphicAssetTargetCompatibility(asset.facts, target).outcome === 'blocked')
		.map(target => VIDEO_TARGET_LABELS[target]);
}

watch(() => ({
	reference: props.modelValue,
	refreshSignal: referenceStatusRefreshSignal.value,
}), async ({ reference }) => {
	const flight = referenceStatusFlights.begin();
	if (!reference) {
		referenceStatus.value = undefined;
		return;
	}
	const status = await graphicAssetReferenceStatusOrUnavailable(reference);
	if (flight.current)
		referenceStatus.value = status;
}, { immediate: true });

function selectAsset(asset: GraphicAsset) {
	if (assetCompatibility(asset).outcome === 'blocked')
		return;
	const reference = {
		assetId: asset.id,
		revisionId: asset.revisionId,
	};
	emit('update:modelValue', reference);
	emit('select', asset, reference);
	open.value = false;
}
</script>

<template>
	<div class="space-y-2">
		<div class="flex flex-wrap items-center gap-2">
			<UButton
				data-testid="open-graphic-asset-picker"
				color="neutral"
				variant="outline"
				icon="i-lucide-images"
				:disabled="disabled"
				@click="open = true"
			>
				{{ modelValue ? 'Change Graphic Asset' : 'Choose Graphic Asset' }}
			</UButton>
			<UButton
				v-if="modelValue && clearable"
				data-testid="clear-graphic-asset"
				color="neutral"
				variant="ghost"
				icon="i-lucide-x"
				:disabled="disabled"
				@click="emit('update:modelValue', undefined)"
			>
				Clear
			</UButton>
		</div>
		<p v-if="selectedAsset" class="text-xs text-muted">
			{{ selectedAsset.name }} · revision {{ selectedAsset.revisionNumber }}
		</p>
		<p v-else-if="modelValue && referenceStatus?.outcome === 'available'" class="text-xs text-muted">
			Pinned revision {{ modelValue.revisionId }} is available outside active discovery.
		</p>
		<UAlert
			v-else-if="modelValue && referenceStatus?.outcome === 'missing'"
			color="error"
			variant="soft"
			title="Missing Graphic Asset Reference"
			description="This exact asset or revision does not exist. Publication-requiring actions are unavailable until it is repaired or replaced."
		/>
		<UAlert
			v-else-if="modelValue && referenceStatus?.outcome === 'unavailable'"
			color="warning"
			variant="soft"
			title="Unavailable Graphic Asset Content"
			description="This exact revision still exists but its bytes are temporarily unavailable. Retry before a publication-requiring action."
		/>
		<UButton
			v-if="modelValue && referenceStatus?.outcome === 'unavailable'"
			data-testid="retry-graphic-asset-reference-status"
			color="warning"
			variant="soft"
			icon="i-lucide-refresh-cw"
			@click="retryReferenceStatus"
		>
			Retry Graphic Asset Content
		</UButton>

		<UModal v-model:open="open">
			<template #content>
				<div class="flex max-h-[80vh] w-full max-w-5xl flex-col gap-4 overflow-hidden p-6">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h2 class="text-lg font-semibold">
								{{ fieldLabel }}
							</h2>
							<p class="text-sm text-muted">
								Choose one exact Graphic Asset Revision for Event {{ eventId }}.
							</p>
						</div>
						<UButton
							color="neutral"
							variant="ghost"
							icon="i-lucide-x"
							@click="open = false"
						>
							Close
						</UButton>
					</div>

					<div class="flex flex-wrap gap-2">
						<UInput
							v-model="search"
							class="min-w-64 flex-1"
							icon="i-lucide-search"
							placeholder="Search Graphic Assets"
						/>
						<!--
							Both scopes at once, each with what it holds. One button showing
							the current scope was a toggle nothing announced as one, and its
							count is what separates 'this Event has adopted nothing yet' from
							'my asset is gone' (#234).
						-->
						<div class="flex gap-1" role="group" aria-label="Graphic Asset scope">
							<UButton
								data-testid="graphic-asset-scope-event"
								color="neutral"
								:variant="scope === 'event' ? 'solid' : 'outline'"
								:aria-pressed="scope === 'event'"
								@click="chooseScope('event')"
							>
								This Event ({{ eventAssets.length }})
							</UButton>
							<UButton
								data-testid="graphic-asset-scope-library"
								color="neutral"
								:variant="scope === 'library' ? 'solid' : 'outline'"
								:aria-pressed="scope === 'library'"
								@click="chooseScope('library')"
							>
								All assets ({{ libraryAssets.length }})
							</UButton>
						</div>
						<!--
							A link out of an editor mid-edit, said out loud. It sat among the
							scope controls looking like a third tab, and following it
							abandoned unsaved authoring; a new tab is what an author reaching
							for the Library while placing an item actually meant.
						-->
						<UButton
							to="/graphics-assets"
							target="_blank"
							rel="noopener"
							color="neutral"
							variant="ghost"
							icon="i-lucide-library"
							trailing-icon="i-lucide-external-link"
							data-testid="open-library-workspace"
						>
							Library Workspace
						</UButton>
					</div>

					<UAlert
						v-if="error"
						color="error"
						variant="soft"
						title="Graphic Assets could not be loaded"
						:description="loadFailureMessage"
						data-testid="library-listing-error"
					/>
					<p v-else-if="status === 'pending'" class="text-sm text-muted">
						Loading Graphic Assets…
					</p>
					<div v-else class="grid min-h-0 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
						<article
							v-for="asset in visibleAssets"
							:key="`${asset.id}:${asset.revisionId}`"
							class="flex flex-col gap-3 rounded-lg border border-default bg-default p-3"
						>
							<img
								:src="`/api/graphics-assets/${encodeURIComponent(asset.id)}/thumbnail`"
								:alt="`${asset.name} preview`"
								class="aspect-video w-full rounded bg-muted object-contain"
							>
							<div class="min-w-0">
								<h3 class="truncate font-medium">
									{{ asset.name }}
								</h3>
								<p class="text-xs text-muted">
									Revision {{ asset.revisionNumber }}
									<template v-if="asset.facts.kind === 'image'">
										· {{ asset.facts.width }} × {{ asset.facts.height }}
									</template>
									<template v-else-if="asset.facts.kind === 'silent-video'">
										· {{ asset.facts.width }} × {{ asset.facts.height }} · {{ asset.facts.durationSeconds.toFixed(2) }}s
									</template>
									<template v-else>
										· {{ asset.facts.family }} {{ asset.facts.subfamily }}
									</template>
								</p>
								<div class="mt-2 flex flex-wrap gap-1">
									<UBadge size="xs" variant="soft">
										{{ asset.facts.format.toUpperCase() }} compatible
									</UBadge>
									<UBadge v-if="asset.facts.kind === 'image' && asset.facts.hasAlpha" size="xs" variant="soft">
										Alpha
									</UBadge>
									<UBadge
										v-if="asset.facts.kind === 'silent-video' && asset.facts.hasAlpha"
										size="xs"
										:color="assetCompatibility(asset).outcome === 'blocked' ? 'error' : 'warning'"
										variant="soft"
									>
										VP9 alpha · Chromium only
									</UBadge>
									<UBadge
										v-if="asset.eventIds.includes(eventId)"
										size="xs"
										color="info"
										variant="soft"
									>
										This Event
									</UBadge>
								</div>
								<!--
									What this revision costs the outputs open right now, stated before
									the choice. It never withholds the revision: the cost falls on the
									outputs that cannot play it, and the operator may be choosing for
									the Chromium program output.
								-->
								<p
									v-if="blockedOpenOutputs(asset).length > 0"
									class="mt-2 text-xs text-warning"
									:data-testid="`open-output-incompatible-${asset.id}`"
								>
									Will not play on {{ blockedOpenOutputs(asset).join(', ') }}
									{{ blockedOpenOutputs(asset).length === 1 ? 'output' : 'outputs' }} open now.
								</p>
							</div>
							<UButton
								:data-testid="`select-${asset.id}`"
								class="mt-auto"
								:disabled="assetCompatibility(asset).outcome === 'blocked'"
								@click="selectAsset(asset)"
							>
								{{ assetCompatibility(asset).outcome === 'blocked' ? blockedReason(asset) : `Select revision ${asset.revisionNumber}` }}
							</UButton>
						</article>
						<div v-if="visibleAssets.length === 0" class="text-sm text-muted sm:col-span-2 lg:col-span-3">
							<p>No compatible Graphic Assets match this view.</p>
							<!--
								What the scope is holding back, where an empty grid otherwise
								reads as the asset having been deleted.

								A bare count, with no verb and so no agreement to maintain.
								This read 'N more match(es)', whose arms were chosen to agree
								with a subject the sentence does not contain — giving '1 more
								matches' and '5 more match'. The sentence above already
								supplies the verb.
							-->
							<p v-if="hiddenByScope > 0" class="mt-1" data-testid="graphic-asset-scope-hint">
								{{ hiddenByScope }} more in the whole library, outside this Event.
								<UButton
									size="xs"
									variant="link"
									data-testid="widen-graphic-asset-scope"
									@click="chooseScope('library')"
								>
									Show all assets
								</UButton>
							</p>
						</div>
					</div>
				</div>
			</template>
		</UModal>
	</div>
</template>
