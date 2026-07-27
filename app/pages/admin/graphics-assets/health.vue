<script setup lang="ts">
import type {
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

			<p v-if="health" class="text-xs text-dimmed">
				Last checked {{ new Date(health.checkedAt).toLocaleString() }}
			</p>
		</div>
	</NuxtLayout>
</template>
