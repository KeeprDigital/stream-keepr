<script setup lang="ts">
import type {
	GraphicsAssetLibraryCapacity,
	GraphicsAssetLibraryComponentHealth,
	GraphicsAssetLibraryHealth,
} from '~~/shared/types/graphicsAsset';

definePageMeta({
	title: 'Graphics Asset Library health',
});

const {
	data: health,
	status,
	error,
	refresh,
} = useFetch<GraphicsAssetLibraryHealth>('/api/admin/graphics-assets/health');
const {
	data: capacity,
	error: capacityError,
	refresh: refreshCapacity,
} = useFetch<GraphicsAssetLibraryCapacity>('/api/admin/graphics-assets/capacity');
const bytesPerGiB = 1024 * 1024 * 1024;
const canonicalLimitGiB = ref(100);
const stagingLimitGiB = ref(10);
const capacitySavePending = ref(false);
const capacitySaveError = ref<string | null>(null);
const capacitySaveSucceeded = ref(false);

watch(capacity, (value) => {
	if (!value)
		return;
	canonicalLimitGiB.value = value.canonical.limitBytes / bytesPerGiB;
	stagingLimitGiB.value = value.staging.limitBytes / bytesPerGiB;
}, { immediate: true });

const results = computed(() => health.value
	? [
			{
				label: 'D1 catalogue',
				description: 'Authoritative Graphic Asset identities and operational state.',
				icon: 'i-lucide-database',
				health: health.value.catalogue,
			},
			{
				label: 'Staging byte store',
				description: 'Private provisional transfers and multipart upload state.',
				icon: 'i-lucide-package-open',
				health: health.value.byteStores.staging,
			},
			{
				label: 'Canonical byte store',
				description: 'Private immutable validated source and derivative bytes.',
				icon: 'i-lucide-archive',
				health: health.value.byteStores.canonical,
			},
		]
	: []);

function healthLabel(result: GraphicsAssetLibraryComponentHealth) {
	return result.status === 'healthy' ? 'Healthy' : 'Unavailable';
}

function healthColor(result: GraphicsAssetLibraryComponentHealth) {
	return result.status === 'healthy' ? 'success' : 'error';
}

function refreshHealth() {
	void refresh();
	void refreshCapacity();
}

function formatBytes(byteLength: number) {
	if (byteLength < 1024)
		return `${byteLength} B`;
	if (byteLength < 1024 * 1024)
		return `${(byteLength / 1024).toFixed(1)} KiB`;
	if (byteLength < bytesPerGiB)
		return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`;
	return `${(byteLength / bytesPerGiB).toFixed(1)} GiB`;
}

async function saveCapacityLimits() {
	capacitySavePending.value = true;
	capacitySaveError.value = null;
	capacitySaveSucceeded.value = false;
	try {
		capacity.value = await $fetch<GraphicsAssetLibraryCapacity>(
			'/api/admin/graphics-assets/capacity',
			{
				method: 'PUT',
				body: {
					canonicalLimitBytes: Math.round(canonicalLimitGiB.value * bytesPerGiB),
					stagingLimitBytes: Math.round(stagingLimitGiB.value * bytesPerGiB),
				},
			},
		);
		capacitySaveSucceeded.value = true;
	}
	catch (caught) {
		capacitySaveError.value = caught instanceof Error
			? caught.message
			: 'Capacity limits could not be saved.';
	}
	finally {
		capacitySavePending.value = false;
	}
}
</script>

<template>
	<NuxtLayout name="default">
		<template #actions>
			<UButton
				color="neutral"
				variant="outline"
				icon="i-lucide-refresh-cw"
				:loading="status === 'pending'"
				@click="refreshHealth"
			>
				Refresh
			</UButton>
		</template>

		<div class="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<div>
				<h1 class="text-2xl font-semibold text-highlighted">
					Graphics Asset Library health
				</h1>
				<p class="mt-1 text-sm text-muted">
					Installation-wide catalogue and private byte-store availability.
				</p>
			</div>

			<UAlert
				v-if="error"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Health check could not be loaded"
				:description="error.message"
			/>

			<div v-if="results.length > 0" class="grid gap-4 md:grid-cols-3">
				<UCard v-for="result in results" :key="result.label">
					<div class="flex items-start justify-between gap-4">
						<div class="flex items-start gap-3">
							<div class="rounded-lg bg-elevated p-2 text-muted">
								<UIcon :name="result.icon" class="size-5" />
							</div>
							<div>
								<h2 class="font-medium text-highlighted">
									{{ result.label }}
								</h2>
								<p class="mt-1 text-sm text-muted">
									{{ result.description }}
								</p>
							</div>
						</div>
						<UBadge
							:color="healthColor(result.health)"
							variant="soft"
							:label="healthLabel(result.health)"
						/>
					</div>
				</UCard>
			</div>

			<UAlert
				v-if="capacityError"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
			>
				<p>Capacity could not be loaded — {{ capacityError.message }}</p>
			</UAlert>

			<UCard v-if="capacity">
				<template #header>
					<div>
						<h2 class="font-semibold text-highlighted">
							Installation capacity
						</h2>
						<p class="mt-1 text-sm text-muted">
							Canonical retained bytes and in-progress staging are enforced independently.
						</p>
					</div>
				</template>

				<div class="grid gap-6 lg:grid-cols-2">
					<div class="space-y-4">
						<div>
							<div class="flex items-center justify-between gap-4">
								<h3 class="font-medium text-highlighted">
									Canonical quota
								</h3>
								<UBadge :label="capacity.canonical.pressure" variant="soft" />
							</div>
							<p class="mt-1 text-sm text-muted">
								{{ formatBytes(capacity.canonical.usedBytes) }} used ·
								{{ formatBytes(capacity.canonical.reservedBytes) }} reserved ·
								{{ formatBytes(capacity.canonical.limitBytes) }} limit
							</p>
							<dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
								<div>
									<dt class="text-xs text-dimmed">
										Source content
									</dt>
									<dd class="text-muted">
										{{ formatBytes(capacity.canonical.breakdown.retainedSourceBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Derivatives
									</dt>
									<dd class="text-muted">
										{{ formatBytes(capacity.canonical.breakdown.retainedDerivativeBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Provider cache
									</dt>
									<dd class="text-muted">
										{{ formatBytes(capacity.canonical.breakdown.providerCacheBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Unreachable quarantine
									</dt>
									<dd class="text-muted">
										{{ formatBytes(capacity.canonical.breakdown.unreachableQuarantineBytes) }}
									</dd>
								</div>
							</dl>
						</div>

						<div>
							<h3 class="font-medium text-highlighted">
								Staging allowance
							</h3>
							<p class="mt-1 text-sm text-muted">
								{{ formatBytes(capacity.staging.usedBytes) }} verified ·
								{{ formatBytes(capacity.staging.reservedBytes) }} reserved ·
								{{ formatBytes(capacity.staging.limitBytes) }} limit
							</p>
						</div>
					</div>

					<div class="grid content-start gap-4">
						<UFormField label="Canonical limit" description="GiB">
							<UInput
								v-model.number="canonicalLimitGiB"
								type="number"
								:min="1"
								step="1"
							/>
						</UFormField>
						<UFormField label="Staging limit" description="GiB">
							<UInput
								v-model.number="stagingLimitGiB"
								type="number"
								:min="1"
								step="1"
							/>
						</UFormField>
						<UButton
							label="Save capacity limits"
							icon="i-lucide-save"
							:loading="capacitySavePending"
							@click="saveCapacityLimits"
						/>
						<p v-if="capacitySaveSucceeded" class="text-sm text-success">
							Capacity limits saved.
						</p>
						<p v-if="capacitySaveError" class="text-sm text-error">
							{{ capacitySaveError }}
						</p>
					</div>
				</div>
			</UCard>

			<p v-if="health" class="text-xs text-dimmed">
				Last checked {{ new Date(health.checkedAt).toLocaleString() }}
			</p>
		</div>
	</NuxtLayout>
</template>
