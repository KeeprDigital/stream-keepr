<script setup lang="ts">
import type {
	GraphicsAssetLibraryCapacity,
	GraphicsAssetLibraryComponentHealth,
	GraphicsAssetLibraryHealth,
} from '~~/shared/types/graphicsAsset';
import { formatByteCount } from '~~/shared/utils/formatByteCount';

definePageMeta({
	title: 'Graphics Asset Library health',
});

const bytesPerGiB = 1024 * 1024 * 1024;
const canonicalLimitGiB = ref(100);
const stagingLimitGiB = ref(10);
const capacity = ref<GraphicsAssetLibraryCapacity | null>(null);
const capacityFailureMessage = ref<string | null>(null);
const capacitySavePending = ref(false);
const capacitySaveError = ref<string | null>(null);
const capacitySaveSucceeded = ref(false);

/**
 * Both reads are guarded by the installation's administrator token, so neither can be
 * taken before an administrator supplies one. Taking them bare is what made this page
 * answer nothing but 403 once the guard reached the two routes, and holding the token
 * the way the cockpit and the queues do is what keeps the three surfaces agreeing on
 * what an authorization failure means.
 */
const {
	administratorToken,
	reading: health,
	loadPending,
	loadError: healthFailureMessage,
	hasReading,
	administratorHeaders,
	describeFailure,
	load: loadHealth,
} = useGraphicsAdminReading<GraphicsAssetLibraryHealth>({
	read: async headers => await $fetch<GraphicsAssetLibraryHealth>(
		'/api/admin/graphics-assets/health',
		{ headers },
	),
	failureMessage: 'The library health check could not be read.',
	onAuthorizationLost: () => {
		capacity.value = null;
		capacityFailureMessage.value = null;
	},
	// Capacity is a second reading of the same library taken with the same token. It is
	// kept separate rather than folded into the health read so that a capacity failure
	// still leaves the component health an administrator came here for on screen.
	onReading: async () => {
		await loadCapacity();
	},
	// A save answers with the limits the server now holds. A poll landing while one is in
	// flight would re-read capacity and put the limits from before it back on screen.
	paused: () => capacitySavePending.value,
});

async function loadCapacity() {
	capacityFailureMessage.value = null;
	try {
		capacity.value = await $fetch<GraphicsAssetLibraryCapacity>(
			'/api/admin/graphics-assets/capacity',
			{ headers: administratorHeaders() },
		);
	}
	catch (caught) {
		capacity.value = null;
		capacityFailureMessage.value = describeFailure(caught, 'Capacity could not be read.');
	}
}

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

async function saveCapacityLimits() {
	capacitySavePending.value = true;
	capacitySaveError.value = null;
	capacitySaveSucceeded.value = false;
	try {
		capacity.value = await $fetch<GraphicsAssetLibraryCapacity>(
			'/api/admin/graphics-assets/capacity',
			{
				method: 'PUT',
				headers: administratorHeaders(),
				body: {
					canonicalLimitBytes: Math.round(canonicalLimitGiB.value * bytesPerGiB),
					stagingLimitBytes: Math.round(stagingLimitGiB.value * bytesPerGiB),
				},
			},
		);
		capacitySaveSucceeded.value = true;
	}
	catch (caught) {
		capacitySaveError.value = describeFailure(caught, 'Capacity limits could not be saved.');
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
				:loading="loadPending"
				:disabled="!hasReading"
				@click="loadHealth"
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

			<UCard v-if="!hasReading">
				<template #header>
					<h2 class="font-semibold text-highlighted">
						Graphics Administrator access
					</h2>
				</template>
				<div class="flex flex-col gap-4">
					<UFormField
						label="Graphics Administrator token"
						description="Library health is administrator-only. The token is held for this session only and never stored."
					>
						<UInput
							v-model="administratorToken"
							type="password"
							autocomplete="current-password"
						/>
					</UFormField>
					<div>
						<UButton
							label="Open health"
							icon="i-lucide-activity"
							:loading="loadPending"
							@click="loadHealth"
						/>
					</div>
					<p
						v-if="healthFailureMessage"
						class="text-sm text-error"
						data-testid="health-load-error"
					>
						{{ healthFailureMessage }}
					</p>
				</div>
			</UCard>

			<UAlert
				v-if="hasReading && healthFailureMessage"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="The last health check failed"
				:description="healthFailureMessage"
				data-testid="health-load-error"
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
				v-if="capacityFailureMessage"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				data-testid="capacity-load-error"
			>
				<p>Capacity could not be loaded — {{ capacityFailureMessage }}</p>
			</UAlert>

			<UCard v-if="capacity">
				<template #header>
					<div>
						<h2 class="font-semibold text-highlighted">
							Graphics Asset Library Capacity
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
									Canonical Graphics Quota
								</h3>
								<UBadge :label="capacity.canonical.pressure" variant="soft" />
							</div>
							<p class="mt-1 text-sm text-muted">
								{{ formatByteCount(capacity.canonical.usedBytes) }} used ·
								{{ formatByteCount(capacity.canonical.reservedBytes) }} reserved ·
								{{ formatByteCount(capacity.canonical.limitBytes) }} limit
							</p>
							<dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
								<div>
									<dt class="text-xs text-dimmed">
										Source content
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(capacity.canonical.breakdown.retainedSourceBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Derivatives
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(capacity.canonical.breakdown.retainedDerivativeBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Metadata
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(capacity.canonical.breakdown.metadataBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Provider cache
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(capacity.canonical.breakdown.providerCacheBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Unreachable quarantine
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(capacity.canonical.breakdown.unreachableQuarantineBytes) }}
									</dd>
								</div>
							</dl>
						</div>

						<div>
							<h3 class="font-medium text-highlighted">
								Graphics Staging Allowance
							</h3>
							<p class="mt-1 text-sm text-muted">
								{{ formatByteCount(capacity.staging.usedBytes) }} verified ·
								{{ formatByteCount(capacity.staging.reservedBytes) }} reserved ·
								{{ formatByteCount(capacity.staging.limitBytes) }} limit
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
