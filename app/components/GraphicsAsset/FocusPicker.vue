<script setup lang="ts">
import type {
	GraphicAsset,
	GraphicAssetReference,
	GraphicAssetReferenceStatus,
} from '~~/shared/types/graphicsAsset';

const props = defineProps<{
	modelValue?: GraphicAssetReference;
	eventId: number;
	fieldLabel: string;
}>();

const emit = defineEmits<{
	'update:modelValue': [reference: GraphicAssetReference | undefined];
}>();

const open = ref(false);
const search = ref('');
const thisEventOnly = ref(true);
const referenceStatus = ref<GraphicAssetReferenceStatus>();
let referenceStatusRequest = 0;
const {
	data: assets,
	status,
	error,
} = useFetch<GraphicAsset[]>('/api/graphics-assets', {
	query: computed(() => ({ search: search.value })),
	default: () => [],
});

const visibleAssets = computed(() => (assets.value ?? []).filter(asset =>
	!thisEventOnly.value || asset.eventIds.includes(props.eventId),
));
const selectedAsset = computed(() => (assets.value ?? []).find(asset =>
	asset.id === props.modelValue?.assetId
	&& asset.revisionId === props.modelValue?.revisionId,
));

watch(() => props.modelValue, async (reference) => {
	const request = ++referenceStatusRequest;
	if (!reference) {
		referenceStatus.value = undefined;
		return;
	}
	try {
		const status = await $fetch<GraphicAssetReferenceStatus>(
			`/api/graphics-assets/${encodeURIComponent(reference.assetId)}/revisions/${encodeURIComponent(reference.revisionId)}/status`,
		);
		if (request === referenceStatusRequest)
			referenceStatus.value = status;
	}
	catch {
		if (request === referenceStatusRequest)
			referenceStatus.value = { outcome: 'unavailable', retryable: true };
	}
}, { immediate: true });

function selectAsset(asset: GraphicAsset) {
	emit('update:modelValue', {
		assetId: asset.id,
		revisionId: asset.revisionId,
	});
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
									Revision {{ asset.revisionNumber }} · {{ asset.facts.width }} × {{ asset.facts.height }}
								</p>
								<div class="mt-2 flex flex-wrap gap-1">
									<UBadge size="xs" variant="soft">
										PNG compatible
									</UBadge>
									<UBadge v-if="asset.facts.hasAlpha" size="xs" variant="soft">
										Alpha
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
								@click="selectAsset(asset)"
							>
								Select revision {{ asset.revisionNumber }}
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
