<script setup lang="ts">
import type {
	GraphicAsset,
	GraphicAssetReference,
	GraphicAssetReferenceStatus,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsVideoTarget } from '~~/shared/utils/graphicAssetTargetCompatibility';
import { graphicAssetTargetCompatibility } from '~~/shared/utils/graphicAssetTargetCompatibility';
import { graphicAssetRevisionStatusPath } from '~~/shared/utils/graphicsAssetReferences';
import { createGuardedSequence } from '~/utils/guardedSequence';

const props = withDefaults(defineProps<{
	modelValue?: GraphicAssetReference;
	eventId: number;
	fieldLabel: string;
	assetKind?: GraphicAsset['kind'] | GraphicAsset['kind'][];
	videoTarget?: GraphicsVideoTarget;
}>(), {
	assetKind: 'image',
	videoTarget: 'other',
});

const emit = defineEmits<{
	'update:modelValue': [reference: GraphicAssetReference | undefined];
	'select': [asset: GraphicAsset, reference: GraphicAssetReference];
}>();

const open = ref(false);
const search = ref('');
const thisEventOnly = ref(true);
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

const acceptedKinds = computed<GraphicAsset['kind'][]>(
	() => Array.isArray(props.assetKind) ? props.assetKind : [props.assetKind],
);
const visibleAssets = computed(() => (assets.value ?? []).filter(asset =>
	acceptedKinds.value.includes(asset.kind)
	&& (!thisEventOnly.value || asset.eventIds.includes(props.eventId)),
));
const selectedAsset = computed(() => (assets.value ?? []).find(asset =>
	acceptedKinds.value.includes(asset.kind)
	&& asset.id === props.modelValue?.assetId
	&& asset.revisionId === props.modelValue?.revisionId,
));
function assetCompatibility(asset: GraphicAsset) {
	return graphicAssetTargetCompatibility(asset.facts, props.videoTarget);
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
	try {
		const status = await $fetch<GraphicAssetReferenceStatus>(
			graphicAssetRevisionStatusPath(reference),
		);
		if (flight.current)
			referenceStatus.value = status;
	}
	catch {
		if (flight.current)
			referenceStatus.value = { outcome: 'unavailable', retryable: true };
	}
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
				@click="open = true"
			>
				{{ modelValue ? 'Change Graphic Asset' : 'Choose Graphic Asset' }}
			</UButton>
			<UButton
				v-if="modelValue"
				color="neutral"
				variant="ghost"
				icon="i-lucide-x"
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
						<UButton
							v-if="thisEventOnly"
							data-testid="show-all-assets"
							variant="soft"
							@click="thisEventOnly = false"
						>
							This Event
						</UButton>
						<UButton
							v-else
							data-testid="show-event-assets"
							color="neutral"
							variant="outline"
							@click="thisEventOnly = true"
						>
							All assets
						</UButton>
						<UButton
							to="/graphics-assets"
							color="neutral"
							variant="outline"
							icon="i-lucide-library"
						>
							Library Workspace
						</UButton>
					</div>

					<UAlert
						v-if="error"
						color="error"
						variant="soft"
						title="Graphic Assets could not be loaded"
						:description="error.message"
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
							</div>
							<UButton
								:data-testid="`select-${asset.id}`"
								class="mt-auto"
								:disabled="assetCompatibility(asset).outcome === 'blocked'"
								@click="selectAsset(asset)"
							>
								{{ assetCompatibility(asset).outcome === 'blocked' ? 'Blocked for Safari target' : `Select revision ${asset.revisionNumber}` }}
							</UButton>
						</article>
						<p v-if="visibleAssets.length === 0" class="text-sm text-muted sm:col-span-2 lg:col-span-3">
							No compatible Graphic Assets match this view.
						</p>
					</div>
				</div>
			</template>
		</UModal>
	</div>
</template>
