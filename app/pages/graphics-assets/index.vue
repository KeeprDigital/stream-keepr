<script setup lang="ts">
import type {
	GraphicAsset,
	GraphicsAssetLibraryCapacity,
	GraphicsDuplicateContentPolicy,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { MAX_PNG_INGESTION_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

definePageMeta({
	title: 'Graphics Asset Library',
});

const eventStore = useEventStore();
const search = ref('');
const selectedFile = ref<File | null>(null);
const proposedName = ref('');
const createSeparateAsset = ref(false);
const uploadPending = ref(false);
const uploadError = ref<string | null>(null);
const currentOperation = ref<GraphicsIngestionOperation | null>(null);
const operationStorageKey = 'graphics-asset-ingestion-operation';
const initiationStorageKey = 'graphics-asset-ingestion-initiation';

interface PendingInitiation {
	idempotencyKey: string;
	name: string;
	defaultEventId?: number;
	duplicateContentPolicy: GraphicsDuplicateContentPolicy;
	declaredByteLength: number;
}

const {
	data: assets,
	status,
	error,
	refresh,
} = useFetch<GraphicAsset[]>('/api/graphics-assets', {
	query: computed(() => ({ search: search.value })),
	default: () => [],
});
const {
	data: capacity,
	error: capacityError,
	refresh: refreshCapacity,
} = useFetch<GraphicsAssetLibraryCapacity>('/api/graphics-assets/capacity');

watch(selectedFile, (file) => {
	if (file && !proposedName.value.trim())
		proposedName.value = file.name;
});

const selectionError = computed(() => {
	if (!selectedFile.value)
		return null;
	if (selectedFile.value.type !== 'image/png')
		return 'Select a PNG file.';
	if (selectedFile.value.size === 0)
		return 'The PNG file is empty.';
	if (selectedFile.value.size > MAX_PNG_INGESTION_BYTES)
		return 'The PNG file must not exceed 16 MiB.';
	return null;
});

const canUpload = computed(() =>
	selectedFile.value !== null
	&& proposedName.value.trim().length > 0
	&& selectionError.value === null
	&& !uploadPending.value,
);
function isRetryableOperation(
	operation: GraphicsIngestionOperation | null,
): operation is GraphicsIngestionOperation {
	return operation !== null
		&& operation.stage !== 'created'
		&& operation.stage !== 'completed'
		&& operation.stage !== 'cancelled'
		&& !(operation.stage === 'failed' && !operation.failure?.retryable);
}

const canRetryOperation = computed(() => isRetryableOperation(currentOperation.value));

function readPendingInitiation(): PendingInitiation | null {
	const stored = localStorage.getItem(initiationStorageKey);
	if (!stored)
		return null;
	try {
		return JSON.parse(stored) as PendingInitiation;
	}
	catch {
		localStorage.removeItem(initiationStorageKey);
		return null;
	}
}

function selectedInitiation(): PendingInitiation {
	const name = proposedName.value.trim();
	const duplicateContentPolicy = createSeparateAsset.value ? 'create-separate' : 'reuse';
	const pending = readPendingInitiation();
	if (
		pending
		&& pending.name === name
		&& pending.duplicateContentPolicy === duplicateContentPolicy
		&& pending.declaredByteLength === selectedFile.value!.size
	) {
		return pending;
	}
	const initiation: PendingInitiation = {
		idempotencyKey: crypto.randomUUID(),
		name,
		defaultEventId: eventStore.eventId ?? undefined,
		duplicateContentPolicy,
		declaredByteLength: selectedFile.value!.size,
	};
	localStorage.setItem(initiationStorageKey, JSON.stringify(initiation));
	return initiation;
}

function clearPersistedOperation() {
	localStorage.removeItem(operationStorageKey);
	localStorage.removeItem(initiationStorageKey);
}

function formatBytes(byteLength: number) {
	if (byteLength < 1024)
		return `${byteLength} B`;
	if (byteLength < 1024 * 1024)
		return `${(byteLength / 1024).toFixed(1)} KiB`;
	if (byteLength < 1024 * 1024 * 1024)
		return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`;
	return `${(byteLength / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

const capacityWarning = computed(() => {
	if (!capacity.value || capacity.value.canonical.pressure === 'normal')
		return null;
	if (capacity.value.canonical.pressure === 'full') {
		return {
			title: 'Canonical storage full',
			message: 'Operations that add canonical bytes are blocked. Proven no-growth operations may still complete.',
			color: 'error' as const,
		};
	}
	if (capacity.value.canonical.pressure === 'critical') {
		return {
			title: 'Canonical storage critical',
			message: 'Canonical usage is at or above 95%. Reclaim space before net-new ingestion is blocked.',
			color: 'error' as const,
		};
	}
	return {
		title: 'Canonical storage warning',
		message: 'Canonical usage is at or above 80%. Plan cleanup before the hard limit.',
		color: 'warning' as const,
	};
});

function operationColor(stage: GraphicsIngestionOperation['stage']) {
	if (stage === 'completed')
		return 'success';
	if (stage === 'failed')
		return 'error';
	if (stage === 'cancelled')
		return 'neutral';
	return 'info';
}

async function observeOperationRequest<T>(
	operationId: string,
	request: Promise<T>,
): Promise<T> {
	let pollPending = false;
	const interval = window.setInterval(async () => {
		if (pollPending)
			return;
		pollPending = true;
		try {
			currentOperation.value = await $fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${operationId}`,
			);
		}
		catch {
			// The in-flight mutation remains authoritative; its response handles errors.
		}
		finally {
			pollPending = false;
		}
	}, 250);
	try {
		return await request;
	}
	finally {
		window.clearInterval(interval);
	}
}

async function uploadPng() {
	if (!selectedFile.value || !canUpload.value)
		return;

	uploadPending.value = true;
	uploadError.value = null;
	try {
		const initiation = selectedInitiation();
		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				body: initiation,
			},
		);
		currentOperation.value = initiated;
		localStorage.setItem(operationStorageKey, initiated.id);
		localStorage.removeItem(initiationStorageKey);

		const response = await observeOperationRequest(
			initiated.id,
			fetch(
				`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
				{
					method: 'PUT',
					headers: { 'content-type': selectedFile.value.type },
					body: selectedFile.value,
				},
			),
		);
		if (!response.ok)
			throw new Error(`PNG transfer failed with status ${response.status}`);

		currentOperation.value = await response.json() as GraphicsIngestionOperation;
		if (currentOperation.value.stage === 'completed') {
			clearPersistedOperation();
			selectedFile.value = null;
			proposedName.value = '';
			await refresh();
			await refreshCapacity();
		}
	}
	catch (caught) {
		uploadError.value = caught instanceof Error ? caught.message : 'PNG upload failed.';
	}
	finally {
		uploadPending.value = false;
	}
}

async function retryOperation() {
	const operation = currentOperation.value;
	if (!isRetryableOperation(operation)) {
		return;
	}
	uploadPending.value = true;
	uploadError.value = null;
	try {
		const operationId = operation.id;
		currentOperation.value = await observeOperationRequest(
			operationId,
			$fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${operationId}/retry`,
				{ method: 'POST' },
			),
		);
		if (currentOperation.value.stage === 'completed') {
			clearPersistedOperation();
			await refresh();
			await refreshCapacity();
		}
	}
	catch (caught) {
		uploadError.value = caught instanceof Error ? caught.message : 'PNG retry failed.';
	}
	finally {
		uploadPending.value = false;
	}
}

onMounted(async () => {
	const pending = readPendingInitiation();
	if (pending) {
		proposedName.value = pending.name;
		createSeparateAsset.value = pending.duplicateContentPolicy === 'create-separate';
	}
	const operationId = localStorage.getItem(operationStorageKey);
	if (operationId) {
		try {
			currentOperation.value = await $fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${operationId}`,
			);
			if (currentOperation.value.stage === 'completed' || currentOperation.value.stage === 'cancelled')
				clearPersistedOperation();
			return;
		}
		catch {
			localStorage.removeItem(operationStorageKey);
		}
	}

	if (!pending)
		return;
	try {
		currentOperation.value = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{ method: 'POST', body: pending },
		);
		localStorage.setItem(operationStorageKey, currentOperation.value.id);
		localStorage.removeItem(initiationStorageKey);
		if (currentOperation.value.stage === 'completed' || currentOperation.value.stage === 'cancelled')
			clearPersistedOperation();
	}
	catch {
		// Keep the durable initiation identity so a later reconnect can retry it.
	}
});
</script>

<template>
	<NuxtLayout name="default">
		<div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
			<div>
				<h1 class="text-2xl font-semibold text-highlighted">
					Graphics Asset Library
				</h1>
				<p class="mt-1 text-sm text-muted">
					Upload, verify, preview, and discover installation-wide Graphic Assets.
				</p>
			</div>

			<UCard v-if="capacity">
				<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
					<div>
						<h2 class="font-semibold text-highlighted">
							Storage capacity
						</h2>
						<p class="mt-2 text-sm text-muted">
							Canonical {{ formatBytes(capacity.canonical.usedBytes) }} of {{ formatBytes(capacity.canonical.limitBytes) }}
							<span v-if="capacity.canonical.reservedBytes > 0">
								· {{ formatBytes(capacity.canonical.reservedBytes) }} reserved
							</span>
						</p>
						<p class="mt-1 text-sm text-muted">
							Staging {{ formatBytes(capacity.staging.usedBytes) }} of {{ formatBytes(capacity.staging.limitBytes) }}
							<span v-if="capacity.staging.reservedBytes > 0">
								· {{ formatBytes(capacity.staging.reservedBytes) }} reserved
							</span>
						</p>
					</div>
					<dl class="grid grid-cols-2 gap-3 text-sm">
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
					</dl>
				</div>
				<UAlert
					v-if="capacityWarning"
					class="mt-4"
					:color="capacityWarning.color"
					variant="soft"
					icon="i-lucide-triangle-alert"
				>
					<p class="font-medium">
						{{ capacityWarning.title }}
					</p>
					<p class="mt-1 text-sm">
						{{ capacityWarning.message }}
					</p>
				</UAlert>
			</UCard>

			<UAlert
				v-if="capacityError"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
			>
				<p>Storage capacity could not be loaded — {{ capacityError.message }}</p>
			</UAlert>

			<UCard>
				<template #header>
					<div>
						<h2 class="font-semibold text-highlighted">
							Upload one PNG
						</h2>
						<p class="mt-1 text-sm text-muted">
							The source is staged privately, validated unchanged, and published only when its thumbnail and catalogue facts are complete.
						</p>
					</div>
				</template>

				<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
					<UFormField
						name="png"
						label="PNG source"
						description="One complete PNG, at most 16 MiB."
						required
					>
						<UFileUpload
							v-model="selectedFile"
							accept="image/png,.png"
							variant="area"
							icon="i-lucide-image-up"
							label="Drop a PNG here"
							description="The exact source bytes are preserved."
						/>
					</UFormField>

					<div class="flex flex-col gap-4">
						<UFormField
							name="name"
							label="Asset name"
							description="Searchable library name."
							required
						>
							<UInput
								v-model="proposedName"
								placeholder="Scoreboard logo"
								class="w-full"
							/>
						</UFormField>
						<label class="flex items-start gap-2 text-sm text-muted">
							<input v-model="createSeparateAsset" type="checkbox" class="mt-1">
							<span>Create a separate Graphic Asset even when these exact bytes already exist.</span>
						</label>
						<p v-if="eventStore.eventId" class="text-sm text-muted">
							The upload will be associated with Event {{ eventStore.eventId }}.
						</p>
						<UAlert
							v-if="selectionError"
							color="error"
							variant="soft"
							icon="i-lucide-triangle-alert"
							:title="selectionError"
						/>
						<UButton
							data-testid="upload-png"
							icon="i-lucide-upload"
							label="Upload and validate"
							:loading="uploadPending"
							:disabled="!canUpload"
							@click="uploadPng"
						/>
					</div>
				</div>

				<UAlert
					v-if="uploadError"
					class="mt-4"
					color="error"
					variant="soft"
					icon="i-lucide-circle-x"
					title="Upload failed"
					:description="uploadError"
				/>

				<div v-if="currentOperation" class="mt-4 rounded-lg border border-default bg-elevated/25 p-4">
					<div class="flex flex-wrap items-center gap-2">
						<UBadge
							:color="operationColor(currentOperation.stage)"
							variant="soft"
							:label="currentOperation.stage"
						/>
						<span class="font-mono text-xs text-muted">{{ currentOperation.id }}</span>
					</div>
					<p v-if="currentOperation.failure" class="mt-2 text-sm text-error">
						{{ currentOperation.failure.message }}
					</p>
					<p
						v-if="currentOperation.capacity?.outcome === 'no-canonical-growth'"
						class="mt-2 text-sm text-success"
					>
						No canonical growth — existing source and derivative bytes were reused.
					</p>
					<p
						v-else-if="currentOperation.capacity?.outcome === 'canonical-capacity-blocked'"
						class="mt-2 text-sm text-error"
					>
						Blocked: {{ formatBytes(currentOperation.capacity.growthBytes) }} of canonical growth required with
						{{ formatBytes(currentOperation.capacity.availableBytes) }} available.
					</p>
					<ul
						v-if="currentOperation.report?.outcome === 'rejected'"
						class="mt-2 list-disc space-y-1 pl-5 text-sm text-error"
					>
						<li v-for="issue in currentOperation.report.issues" :key="issue.code">
							{{ issue.code }} — {{ issue.message }}
						</li>
					</ul>
					<UButton
						v-if="canRetryOperation"
						class="mt-3"
						icon="i-lucide-refresh-cw"
						:label="currentOperation.stage === 'failed' ? 'Retry from staged bytes' : 'Resume if interrupted'"
						:loading="uploadPending"
						@click="retryOperation"
					/>
					<p v-if="currentOperation.result" class="mt-2 text-sm text-muted">
						{{ currentOperation.result.outcome === 'published' ? 'Published' : 'Reused' }} asset {{ currentOperation.result.assetId }} revision {{ currentOperation.result.revisionId }}
					</p>
				</div>
			</UCard>

			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="text-lg font-semibold text-highlighted">
						Active Graphic Assets
					</h2>
					<p class="text-sm text-muted">
						Only atomically published assets appear here.
					</p>
				</div>
				<UInput
					v-model="search"
					icon="i-lucide-search"
					placeholder="Search assets"
					class="w-full sm:max-w-sm"
				/>
			</div>

			<UAlert
				v-if="error"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Library could not be loaded"
				:description="error.message"
			/>

			<div v-if="assets.length > 0" class="grid gap-4 lg:grid-cols-2">
				<UCard v-for="asset in assets" :key="asset.id">
					<div class="flex gap-4">
						<div class="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-default bg-elevated/50">
							<img
								:src="`/api/graphics-assets/${asset.id}/thumbnail`"
								:alt="`${asset.name} preview`"
								class="max-h-full max-w-full object-contain"
							>
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<h3 class="font-semibold text-highlighted">
									{{ asset.name }}
								</h3>
								<UBadge color="success" variant="soft" label="Validated" />
							</div>
							<dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
								<div>
									<dt class="text-xs text-dimmed">
										Dimensions
									</dt>
									<dd class="text-muted">
										{{ asset.facts.width }} × {{ asset.facts.height }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Source
									</dt>
									<dd class="text-muted">
										{{ asset.facts.canonicalMime }} · {{ formatBytes(asset.facts.byteLength) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Pixels
									</dt>
									<dd class="text-muted">
										{{ asset.facts.pixelCount }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Colour
									</dt>
									<dd class="text-muted">
										8-bit {{ asset.facts.colorModel }} · alpha {{ asset.facts.hasAlpha ? 'yes' : 'no' }}
									</dd>
								</div>
							</dl>
							<p class="mt-3 text-xs text-dimmed">
								Compatibility png-v1
							</p>
							<p class="mt-3 truncate font-mono text-xs text-dimmed" :title="asset.facts.sha256">
								SHA-256 {{ asset.facts.sha256 }}
							</p>
							<div class="mt-3 flex flex-wrap gap-1">
								<UBadge
									v-for="eventId in asset.eventIds"
									:key="eventId"
									color="neutral"
									variant="soft"
									:label="`Event ${eventId}`"
								/>
							</div>
						</div>
					</div>

					<template #footer>
						<div class="grid gap-1 font-mono text-xs text-dimmed">
							<span>Operation {{ asset.operation.id }}</span>
							<span>Result {{ JSON.stringify(asset.operation.result) }}</span>
							<span>Asset {{ asset.id }} · Revision {{ asset.revisionId }}</span>
						</div>
					</template>
				</UCard>
			</div>

			<div
				v-else-if="status !== 'pending'"
				class="rounded-lg border border-dashed border-default px-6 py-10 text-center"
			>
				<UIcon name="i-lucide-images" class="mx-auto size-8 text-dimmed" />
				<p class="mt-3 font-medium text-highlighted">
					No matching Graphic Assets
				</p>
				<p class="mt-1 text-sm text-muted">
					Upload a PNG or change the search.
				</p>
			</div>
		</div>
	</NuxtLayout>
</template>
