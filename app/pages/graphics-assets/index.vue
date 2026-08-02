<script setup lang="ts">
import type {
	GraphicAsset,
	GraphicAssetBrowserValidationEvidence,
	GraphicAssetLifecycleAction,
	GraphicAssetLifecycleActionOutcome,
	GraphicAssetLifecycleState,
	GraphicAssetSourceDeclarations,
	GraphicAssetUsage,
	GraphicsAssetLibraryCapacity,
	GraphicsDuplicateContentPolicy,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { formatByteCount } from '~~/shared/utils/formatByteCount';
import { graphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import {
	GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
	GRAPHICS_MULTIPART_PART_BYTES,
	MAX_SILENT_VIDEO_INGESTION_BYTES,
	MAX_STATIC_FONT_INGESTION_BYTES,
	MAX_STILL_IMAGE_INGESTION_BYTES,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { verifyStaticFontBrowserLoad } from '~/utils/verifyStaticFontBrowserLoad';
import { verifyStillImageBrowserDecode } from '~/utils/verifyStillImageBrowserDecode';

definePageMeta({
	title: 'Graphics Asset Library',
});

const eventStore = useEventStore();
const authorSession = useGraphicsAuthorSession();
const search = ref('');
const lifecycleState = ref<GraphicAssetLifecycleState>('active');
const lifecycleViews: {
	state: GraphicAssetLifecycleState;
	label: string;
}[] = [
	{ state: 'active', label: 'Active assets' },
	{ state: 'retired', label: 'Retired assets' },
	{ state: 'trashed', label: 'Trash' },
];
const lifecyclePresentation = {
	active: {
		label: 'Active',
		badgeColor: 'success',
		actions: ['retire', 'trash'],
	},
	retired: {
		label: 'Retired',
		badgeColor: 'warning',
		actions: ['trash', 'restore'],
	},
	trashed: {
		label: 'Trash',
		badgeColor: 'error',
		actions: ['restore'],
	},
} as const satisfies Record<GraphicAssetLifecycleState, {
	label: string;
	badgeColor: 'success' | 'warning' | 'error';
	actions: readonly GraphicAssetLifecycleAction[];
}>;
const selectedFile = ref<File | null>(null);
const proposedName = ref('');
const createSeparateAsset = ref(false);
const remoteSourceUrl = ref('');
const remoteProposedName = ref('');
const remoteCreateSeparateAsset = ref(false);
const remoteCopyPending = ref(false);
const remoteCopyError = ref<string | null>(null);
const uploadPending = ref(false);
const uploadError = ref<string | null>(null);
const currentOperation = ref<GraphicsIngestionOperation | null>(null);
const usageByAssetId = reactive<Record<string, GraphicAssetUsage[] | undefined>>({});
const usagePendingAssetId = ref<string | null>(null);
const editingAssetId = ref<string | null>(null);
const editedName = ref('');
const editedEventIds = ref('');
const metadataPending = ref(false);
const metadataError = ref<string | null>(null);
const replacementAssetId = ref<string | null>(null);
const replacementFile = ref<File | null>(null);
const replacementPending = ref(false);
const replacementError = ref<string | null>(null);
const lifecyclePendingAssetId = ref<string | null>(null);
const lifecycleErrorByAssetId = reactive<Record<string, string | undefined>>({});
const operationStorageKey = 'graphics-asset-ingestion-operation';
const initiationStorageKey = 'graphics-asset-ingestion-initiation';

interface PendingInitiation extends GraphicAssetSourceDeclarations {
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
	query: computed(() => ({
		search: search.value,
		lifecycleStates: lifecycleState.value,
	})),
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
	const supportedMime = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(selectedFile.value.type);
	const sourceKind = graphicAssetSourceKind({
		sourceFileName: selectedFile.value.name,
		declaredMime: selectedFile.value.type,
	});
	const isFont = sourceKind === 'font';
	const isVideo = sourceKind === 'silent-video';
	const supportedExtension = /\.(?:png|jpe?g|webp|mp4|webm|woff2?|ttf|otf)$/i.test(selectedFile.value.name);
	if (
		(selectedFile.value.type && !supportedMime && !isFont)
		|| (!selectedFile.value.type && !supportedExtension)
	) {
		return 'Select a PNG, JPEG, WebP, H.264 MP4, VP9 WebM, WOFF2, WOFF, TTF, or OTF source.';
	}
	if (selectedFile.value.size === 0)
		return 'The Graphic Asset source is empty.';
	if (isFont && selectedFile.value.size > MAX_STATIC_FONT_INGESTION_BYTES)
		return 'The font file must not exceed 10 MiB.';
	if (isVideo && selectedFile.value.size > MAX_SILENT_VIDEO_INGESTION_BYTES)
		return 'The silent video file must not exceed 250 MiB.';
	if (!isFont && !isVideo && selectedFile.value.size > MAX_STILL_IMAGE_INGESTION_BYTES)
		return 'The image file must not exceed 25 MiB.';
	return null;
});

const canUpload = computed(() =>
	selectedFile.value !== null
	&& proposedName.value.trim().length > 0
	&& selectionError.value === null
	&& !uploadPending.value,
);

/**
 * Only the path is read from an approved remote URL. Its query parameters and
 * fragment are secrets: they are sent once with the copy request and are never
 * stored, displayed, or used to name the Graphic Asset.
 */
const remoteSourcePath = computed(() => {
	try {
		return new URL(remoteSourceUrl.value.trim());
	}
	catch {
		return null;
	}
});

const remoteSourceFileName = computed(() => {
	const fileName = remoteSourcePath.value?.pathname.split('/').at(-1);
	return fileName && /\.[a-z0-9]{2,5}$/i.test(fileName)
		? decodeURIComponent(fileName).slice(0, 255)
		: undefined;
});

const remoteSelectionError = computed(() => {
	if (!remoteSourceUrl.value.trim())
		return null;
	const url = remoteSourcePath.value;
	if (!url)
		return 'Enter an absolute public HTTPS URL.';
	if (url.protocol !== 'https:')
		return 'Only public HTTPS sources may be copied into the library.';
	if (url.username || url.password)
		return 'An approved remote source must not carry embedded credentials.';
	return null;
});

const canCopyRemoteSource = computed(() =>
	remoteSourcePath.value !== null
	&& remoteSelectionError.value === null
	&& remoteProposedName.value.trim().length > 0
	&& !remoteCopyPending.value,
);

const awaitingStagedConfirmation = computed(() =>
	currentOperation.value?.stage === 'awaiting-confirmation'
	&& currentOperation.value.source === 'remote-copy',
);
/**
 * An approved remote copy whose bytes never reached staging is retried by
 * re-sending the URL, so it remains retryable from `created` as well.
 */
function needsRemoteSourceRetry(operation: GraphicsIngestionOperation) {
	return operation.source === 'remote-copy'
		&& operation.transferredByteLength === 0
		&& operation.stage !== 'completed'
		&& operation.stage !== 'cancelled'
		&& !(operation.stage === 'failed' && !operation.failure?.retryable);
}

function isRetryableOperation(
	operation: GraphicsIngestionOperation | null,
): operation is GraphicsIngestionOperation {
	if (operation === null)
		return false;
	if (needsRemoteSourceRetry(operation))
		return true;
	return operation.stage !== 'created'
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

function browserEvidenceMatches(
	left: GraphicAssetBrowserValidationEvidence | undefined,
	right: GraphicAssetBrowserValidationEvidence | undefined,
) {
	if (!left || !right)
		return left === right;
	return left?.outcome === right.outcome
		&& left.sourceDigest === right.sourceDigest
		&& (
			left.outcome !== 'decoded'
			|| right.outcome !== 'decoded'
			|| (left.width === right.width && left.height === right.height)
		);
}

function selectedInitiation(
	browserDecodeEvidence?: GraphicAssetBrowserValidationEvidence,
): PendingInitiation {
	const name = proposedName.value.trim();
	const duplicateContentPolicy = createSeparateAsset.value ? 'create-separate' : 'reuse';
	const pending = readPendingInitiation();
	if (
		pending
		&& pending.name === name
		&& pending.duplicateContentPolicy === duplicateContentPolicy
		&& pending.declaredByteLength === selectedFile.value!.size
		&& pending.sourceFileName === selectedFile.value!.name
		&& pending.declaredMime === (selectedFile.value!.type || undefined)
		&& browserEvidenceMatches(pending.browserDecodeEvidence, browserDecodeEvidence)
	) {
		return pending;
	}
	const initiation: PendingInitiation = {
		idempotencyKey: crypto.randomUUID(),
		name,
		defaultEventId: eventStore.eventId ?? undefined,
		duplicateContentPolicy,
		declaredByteLength: selectedFile.value!.size,
		sourceFileName: selectedFile.value!.name,
		declaredMime: selectedFile.value!.type || undefined,
		browserDecodeEvidence,
	};
	localStorage.setItem(initiationStorageKey, JSON.stringify(initiation));
	return initiation;
}

function clearPersistedOperation() {
	localStorage.removeItem(operationStorageKey);
	localStorage.removeItem(initiationStorageKey);
}

const capacityWarning = computed(() => {
	if (!capacity.value || capacity.value.canonical.pressure === 'normal')
		return null;
	if (capacity.value.canonical.pressure === 'full') {
		return {
			title: 'Canonical Capacity Pressure: full',
			message: 'Operations that add canonical bytes are blocked. Proven no-growth operations may still complete.',
			color: 'error' as const,
		};
	}
	if (capacity.value.canonical.pressure === 'critical') {
		return {
			title: 'Canonical Capacity Pressure: critical',
			message: 'Canonical Graphics Quota use is at or above 95%. Reclaim space before net-new ingestion is blocked.',
			color: 'error' as const,
		};
	}
	return {
		title: 'Canonical Capacity Pressure: warning',
		message: 'Canonical Graphics Quota use is at or above 80%. Plan cleanup before the hard limit.',
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

function operationOutcomeLabel(outcome: NonNullable<GraphicsIngestionOperation['result']>['outcome']) {
	if (outcome === 'published')
		return 'Published';
	if (outcome === 'reused')
		return 'Reused';
	if (outcome === 'revision-created')
		return 'Created Graphic Asset Revision';
	return 'Graphic Asset Content unchanged';
}

function templatePackageInstallationLabel(
	installation: NonNullable<GraphicsIngestionOperation['templatePackageInstallation']>,
) {
	return `Installed Template "${installation.templateName}" with ${installation.assets.length} Graphic Asset ${
		installation.assets.length === 1 ? 'Revision' : 'Revisions'
	}`;
}

async function inspectUsage(asset: GraphicAsset) {
	usagePendingAssetId.value = asset.id;
	try {
		usageByAssetId[asset.id] = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${asset.id}/usage`,
		);
	}
	finally {
		usagePendingAssetId.value = null;
	}
}

function replaceVisibleAsset(updated: GraphicAsset) {
	const index = assets.value.findIndex(asset => asset.id === updated.id);
	if (index !== -1)
		assets.value.splice(index, 1, updated);
}

async function runLifecycleAction(
	asset: GraphicAsset,
	action: GraphicAssetLifecycleAction,
) {
	lifecyclePendingAssetId.value = asset.id;
	lifecycleErrorByAssetId[asset.id] = undefined;
	try {
		const outcome = await $fetch<GraphicAssetLifecycleActionOutcome>(
			`/api/graphics-assets/${asset.id}/lifecycle-actions`,
			{ method: 'POST', body: { action } },
		);
		if (outcome.outcome === 'in-use') {
			usageByAssetId[asset.id] = outcome.usage;
			lifecycleErrorByAssetId[asset.id]
				= 'This Graphic Asset cannot enter Trash while any Graphic Asset Revision is in use.';
			return;
		}
		replaceVisibleAsset(outcome.asset);
		await refresh();
	}
	catch (caught) {
		lifecycleErrorByAssetId[asset.id] = authorSession.describeFailure(
			caught,
			'Graphic Asset lifecycle action failed.',
		);
	}
	finally {
		lifecyclePendingAssetId.value = null;
	}
}

function lifecycleAllows(asset: GraphicAsset, action: GraphicAssetLifecycleAction) {
	return (lifecyclePresentation[asset.lifecycle.state].actions as readonly GraphicAssetLifecycleAction[])
		.includes(action);
}

function beginMetadataEdit(asset: GraphicAsset) {
	editingAssetId.value = asset.id;
	editedName.value = asset.name;
	editedEventIds.value = asset.eventIds.join(', ');
	metadataError.value = null;
}

async function saveMetadata(asset: GraphicAsset) {
	const eventIds = editedEventIds.value.trim()
		? editedEventIds.value.split(',').map(value => Number(value.trim()))
		: [];
	if (eventIds.some(value => !Number.isSafeInteger(value) || value <= 0)) {
		metadataError.value = 'Event associations must be comma-separated positive Event IDs.';
		return;
	}
	metadataPending.value = true;
	metadataError.value = null;
	try {
		await $fetch(`/api/graphics-assets/${asset.id}`, {
			method: 'PATCH',
			body: {
				name: editedName.value,
				eventIds,
			},
		});
		editingAssetId.value = null;
		await refresh();
	}
	catch (caught) {
		metadataError.value = authorSession.describeFailure(
			caught,
			'Graphic Asset metadata could not be updated.',
		);
	}
	finally {
		metadataPending.value = false;
	}
}

function beginReplacement(asset: GraphicAsset) {
	replacementAssetId.value = asset.id;
	replacementFile.value = null;
	replacementError.value = null;
}

async function transferGraphicAsset(
	operation: GraphicsIngestionOperation,
	file: File,
) {
	let completed: GraphicsIngestionOperation;
	if (file.size > GRAPHICS_MULTIPART_PART_BYTES) {
		completed = await transferMultipartGraphicAsset(operation, file);
	}
	else {
		const response = await observeOperationRequest(
			operation.id,
			fetch(`/api/graphics-assets/ingestion-operations/${operation.id}/content`, {
				method: 'PUT',
				headers: file.type ? { 'content-type': file.type } : undefined,
				body: file,
			}),
		);
		completed = await operationFromResponse(response, 'Graphic Asset transfer');
	}
	if (
		completed.stage === 'awaiting-confirmation'
		&& completed.report?.outcome === 'accepted'
		&& completed.report.facts.kind === 'font'
	) {
		const evidence = await verifyStaticFontBrowserLoad(
			file,
			completed.report.facts.browserChallenge,
		);
		completed = await observeOperationRequest(
			completed.id,
			$fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${completed.id}/font-browser-evidence`,
				{ method: 'POST', body: evidence },
			),
		);
	}
	return completed;
}

async function initiateAndTransferGraphicAsset(
	file: File,
	endpoint: string,
	body: PendingInitiation | Record<string, unknown>,
	existingOperation?: GraphicsIngestionOperation,
) {
	const initiated = existingOperation ?? await $fetch<GraphicsIngestionOperation>(
		endpoint,
		{ method: 'POST', body },
	);
	currentOperation.value = initiated;
	localStorage.setItem(operationStorageKey, initiated.id);
	localStorage.removeItem(initiationStorageKey);

	const completed = await transferGraphicAsset(initiated, file);
	currentOperation.value = completed;
	if (completed.stage === 'completed')
		clearPersistedOperation();
	return completed;
}

async function replaceAsset(asset: GraphicAsset) {
	const file = replacementFile.value;
	if (!file || replacementPending.value)
		return;
	replacementPending.value = true;
	replacementError.value = null;
	try {
		const leadingBytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
		const sourceKind = graphicAssetSourceKind({
			sourceFileName: file.name,
			declaredMime: file.type,
		}, leadingBytes);
		const browserDecodeEvidence = sourceKind === 'font' || sourceKind === 'silent-video'
			? undefined
			: await verifyStillImageBrowserDecode(file);
		const completed = await initiateAndTransferGraphicAsset(
			file,
			`/api/graphics-assets/${asset.id}/replacement-operations`,
			{
				idempotencyKey: crypto.randomUUID(),
				sourceFileName: file.name,
				declaredMime: file.type || undefined,
				browserDecodeEvidence,
				declaredByteLength: file.size,
			},
		);
		if (completed.stage === 'completed') {
			replacementAssetId.value = null;
			replacementFile.value = null;
			await refresh();
			await refreshCapacity();
			await inspectUsage(asset);
		}
	}
	catch (caught) {
		replacementError.value = authorSession.describeFailure(
			caught,
			'Graphic Asset replacement failed.',
		);
	}
	finally {
		replacementPending.value = false;
	}
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

function operationMatchesSelectedFile(
	operation: GraphicsIngestionOperation,
	file: File,
	name: string,
) {
	return operation.name === name
		&& operation.declaredByteLength === file.size
		&& (!operation.sourceFileName || operation.sourceFileName === file.name)
		&& (!operation.declaredMime || !file.type || operation.declaredMime === file.type);
}

/**
 * The status travels with the failure, not only in its sentence.
 *
 * These branches are hand-rolled `fetch` rather than `$fetch`, so nothing
 * attaches a status for them. Without one a refused request is a string that
 * reads like every other string, and the surface cannot tell a lapsed graphics
 * author session from a byte store that was briefly unavailable.
 */
async function operationFromResponse(response: Response, action: string) {
	if (!response.ok) {
		throw Object.assign(
			new Error(`${action} failed with status ${response.status}`),
			{ status: response.status },
		);
	}
	return await response.json() as GraphicsIngestionOperation;
}

function observeNewerOperation(operation: GraphicsIngestionOperation) {
	if (
		!currentOperation.value
		|| operation.transferredByteLength >= currentOperation.value.transferredByteLength
	) {
		currentOperation.value = operation;
	}
}

async function transferMultipartGraphicAsset(
	operation: GraphicsIngestionOperation,
	file: File,
) {
	let checkpoint = await $fetch<GraphicsIngestionOperation>(
		`/api/graphics-assets/ingestion-operations/${operation.id}/multipart`,
		{ method: 'POST' },
	);
	currentOperation.value = checkpoint;
	if (!checkpoint.transfer)
		throw new Error('Server did not return multipart transfer facts.');
	const transfer: NonNullable<GraphicsIngestionOperation['transfer']> = checkpoint.transfer;
	const completedPartNumbers = new Set(transfer.completedParts.map(part => part.partNumber));
	const pendingPartNumbers = Array.from(
		{ length: transfer.partCount },
		(_, index) => index + 1,
	).filter(partNumber => !completedPartNumbers.has(partNumber));
	let nextPartIndex = 0;

	async function uploadNextParts() {
		while (nextPartIndex < pendingPartNumbers.length) {
			const partNumber = pendingPartNumbers[nextPartIndex++]!;
			const offset = (partNumber - 1) * transfer.partByteLength;
			const part = file.slice(offset, Math.min(file.size, offset + transfer.partByteLength));
			for (let attempt = 1; attempt <= transfer.maximumPartAttempts; attempt++) {
				try {
					const response = await fetch(
						`/api/graphics-assets/ingestion-operations/${operation.id}/multipart/parts/${partNumber}`,
						{ method: 'PUT', body: part },
					);
					checkpoint = await operationFromResponse(
						response,
						`Multipart part ${partNumber}`,
					);
					observeNewerOperation(checkpoint);
					break;
				}
				catch (caught) {
					// A part refused for want of an author will be refused again by
					// every remaining attempt, and the operation it belongs to is
					// already unreachable. Stop rather than spend the attempts.
					if (graphicsAuthorSessionLapsed(caught) || attempt === transfer.maximumPartAttempts)
						throw caught;
				}
			}
		}
	}

	const workerCount = Math.min(
		pendingPartNumbers.length,
		transfer.maximumConcurrentParts,
		GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
	);
	await Promise.all(Array.from({ length: workerCount }, () => uploadNextParts()));
	currentOperation.value = await $fetch<GraphicsIngestionOperation>(
		`/api/graphics-assets/ingestion-operations/${operation.id}`,
	);
	return await observeOperationRequest(
		operation.id,
		$fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}/multipart/complete`,
			{ method: 'POST' },
		),
	);
}

async function refreshAfterTerminalOperation() {
	if (currentOperation.value?.stage !== 'completed')
		return;
	clearPersistedOperation();
	selectedFile.value = null;
	proposedName.value = '';
	await refresh();
	await refreshCapacity();
}

async function uploadGraphicAsset() {
	if (!selectedFile.value || !canUpload.value)
		return;

	uploadPending.value = true;
	uploadError.value = null;
	try {
		const file = selectedFile.value;
		const leadingBytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
		const sourceKind = graphicAssetSourceKind({
			sourceFileName: file.name,
			declaredMime: file.type,
		}, leadingBytes);
		const browserDecodeEvidence = sourceKind === 'font' || sourceKind === 'silent-video'
			? undefined
			: await verifyStillImageBrowserDecode(file);
		const initiation = selectedInitiation(browserDecodeEvidence);
		const reusableOperation = currentOperation.value
			&& !['completed', 'cancelled'].includes(currentOperation.value.stage)
			&& operationMatchesSelectedFile(
				currentOperation.value,
				file,
				initiation.name,
			)
			? currentOperation.value
			: undefined;
		currentOperation.value = await initiateAndTransferGraphicAsset(
			file,
			'/api/graphics-assets/ingestion-operations',
			initiation,
			reusableOperation,
		);
		await refreshAfterTerminalOperation();
	}
	catch (caught) {
		uploadError.value = authorSession.describeFailure(caught, 'Graphic Asset upload failed.');
	}
	finally {
		uploadPending.value = false;
	}
}

/**
 * An approved remote copy has no client-side source file, so browser decode and
 * font evidence are produced from the exact staged bytes instead.
 */
async function confirmStagedGraphicAssetSource(operation: GraphicsIngestionOperation) {
	if (
		operation.stage !== 'awaiting-confirmation'
		|| operation.report?.outcome !== 'accepted'
		|| operation.source !== 'remote-copy'
	) {
		return operation;
	}
	const response = await fetch(
		`/api/graphics-assets/ingestion-operations/${operation.id}/staged-source`,
	);
	if (!response.ok) {
		throw Object.assign(
			new Error(
				`The staged Graphic Asset source could not be read for confirmation (status ${response.status}).`,
			),
			{ status: response.status },
		);
	}
	const staged = await response.blob();
	const evidence = operation.report.facts.kind === 'font'
		? await verifyStaticFontBrowserLoad(staged, operation.report.facts.browserChallenge)
		: await verifyStillImageBrowserDecode(staged);
	return await observeOperationRequest(
		operation.id,
		$fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}/browser-evidence`,
			{ method: 'POST', body: evidence },
		),
	);
}

async function sendRemoteSourceCopy(
	operation: GraphicsIngestionOperation,
	sourceUrl: string,
) {
	const copied = await observeOperationRequest(
		operation.id,
		$fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}/remote-copy`,
			{ method: 'POST', body: { sourceUrl } },
		),
	);
	return await confirmStagedGraphicAssetSource(copied);
}

async function copyRemoteGraphicAssetSource() {
	if (!canCopyRemoteSource.value)
		return;
	remoteCopyPending.value = true;
	remoteCopyError.value = null;
	try {
		const sourceUrl = remoteSourceUrl.value.trim();
		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				body: {
					idempotencyKey: crypto.randomUUID(),
					name: remoteProposedName.value.trim(),
					source: 'remote-copy',
					sourceFileName: remoteSourceFileName.value,
					defaultEventId: eventStore.eventId ?? undefined,
					duplicateContentPolicy: remoteCreateSeparateAsset.value
						? 'create-separate'
						: 'reuse',
				},
			},
		);
		currentOperation.value = initiated;
		// Only the durable operation identity is persisted. The URL is deliberately
		// not stored anywhere, so a retry after reconnect asks for it again.
		localStorage.setItem(operationStorageKey, initiated.id);
		localStorage.removeItem(initiationStorageKey);
		currentOperation.value = await sendRemoteSourceCopy(initiated, sourceUrl);
		if (currentOperation.value.stage === 'completed') {
			remoteSourceUrl.value = '';
			remoteProposedName.value = '';
		}
		await refreshAfterTerminalOperation();
	}
	catch (caught) {
		remoteCopyError.value = authorSession.describeFailure(
			caught,
			'The approved remote Graphic Asset copy failed.',
		);
	}
	finally {
		remoteCopyPending.value = false;
	}
}

async function confirmStagedSource() {
	const operation = currentOperation.value;
	if (!operation || !awaitingStagedConfirmation.value)
		return;
	remoteCopyPending.value = true;
	remoteCopyError.value = null;
	try {
		currentOperation.value = await confirmStagedGraphicAssetSource(operation);
		await refreshAfterTerminalOperation();
	}
	catch (caught) {
		remoteCopyError.value = authorSession.describeFailure(
			caught,
			'The staged Graphic Asset source could not be confirmed.',
		);
	}
	finally {
		remoteCopyPending.value = false;
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
		if (needsRemoteSourceRetry(operation)) {
			const sourceUrl = remoteSourceUrl.value.trim();
			if (!sourceUrl || remoteSelectionError.value) {
				throw new Error(
					'Re-enter the approved HTTPS URL to retry this copy. The URL is never stored.',
				);
			}
			currentOperation.value = await sendRemoteSourceCopy(operation, sourceUrl);
			await refreshAfterTerminalOperation();
			return;
		}
		if (operation.transfer && operation.stage === 'transferring') {
			const file = selectedFile.value;
			if (!file || !operationMatchesSelectedFile(operation, file, operation.name)) {
				throw new Error(
					'Reselect the same source file to resume from the verified multipart checkpoint.',
				);
			}
			currentOperation.value = await transferMultipartGraphicAsset(operation, file);
			await refreshAfterTerminalOperation();
			return;
		}
		currentOperation.value = await observeOperationRequest(
			operationId,
			$fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${operationId}/retry`,
				{ method: 'POST' },
			),
		);
		await refreshAfterTerminalOperation();
	}
	catch (caught) {
		uploadError.value = authorSession.describeFailure(caught, 'Graphic Asset retry failed.');
	}
	finally {
		uploadPending.value = false;
	}
}

async function cancelOperation() {
	const operation = currentOperation.value;
	if (
		!operation
		|| operation.stage === 'completed'
		|| (operation.stage === 'cancelled' && !operation.transfer?.cleanupPending)
	) {
		return;
	}
	uploadPending.value = true;
	uploadError.value = null;
	try {
		currentOperation.value = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}`,
			{ method: 'DELETE' },
		);
		if (!currentOperation.value.transfer?.cleanupPending)
			clearPersistedOperation();
		await refreshCapacity();
	}
	catch (caught) {
		uploadError.value = authorSession.describeFailure(caught, 'Cancellation failed.');
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
			const restoredRemoteCopy = currentOperation.value.source === 'remote-copy';
			if (restoredRemoteCopy) {
				remoteProposedName.value ||= currentOperation.value.name;
				remoteCreateSeparateAsset.value
					= currentOperation.value.duplicateContentPolicy === 'create-separate';
			}
			else {
				proposedName.value ||= currentOperation.value.name;
				createSeparateAsset.value
					= currentOperation.value.duplicateContentPolicy === 'create-separate';
			}
			if (
				currentOperation.value.stage === 'completed'
				|| (
					currentOperation.value.stage === 'cancelled'
					&& !currentOperation.value.transfer?.cleanupPending
				)
			) {
				clearPersistedOperation();
			}
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
		if (
			currentOperation.value.stage === 'completed'
			|| (
				currentOperation.value.stage === 'cancelled'
				&& !currentOperation.value.transfer?.cleanupPending
			)
		) {
			clearPersistedOperation();
		}
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
							Canonical {{ formatByteCount(capacity.canonical.usedBytes) }} of {{ formatByteCount(capacity.canonical.limitBytes) }}
							<span v-if="capacity.canonical.reservedBytes > 0">
								· {{ formatByteCount(capacity.canonical.reservedBytes) }} reserved
							</span>
						</p>
						<p class="mt-1 text-sm text-muted">
							Staging {{ formatByteCount(capacity.staging.usedBytes) }} of {{ formatByteCount(capacity.staging.limitBytes) }}
							<span v-if="capacity.staging.reservedBytes > 0">
								· {{ formatByteCount(capacity.staging.reservedBytes) }} reserved
							</span>
						</p>
					</div>
					<dl class="grid grid-cols-2 gap-3 text-sm">
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

			<UAlert
				v-if="authorSession.lapsed.value"
				color="error"
				variant="soft"
				icon="i-lucide-user-x"
			>
				<p class="font-medium">
					{{ authorSession.lapsedNotice.title }}
				</p>
				<p class="mt-1 text-sm">
					{{ authorSession.lapsedNotice.body }}
				</p>
				<UButton
					class="mt-3"
					data-testid="reload-graphics-author-session"
					icon="i-lucide-rotate-ccw"
					label="Reload and start a new session"
					@click="authorSession.reload"
				/>
			</UAlert>

			<UCard>
				<template #header>
					<div>
						<h2 class="font-semibold text-highlighted">
							Add one asset
						</h2>
						<p class="mt-1 text-sm text-muted">
							Upload a local file or copy an approved public HTTPS source. Either way the source is staged privately, validated unchanged, and published only when its dependent preview and catalogue facts are complete.
						</p>
					</div>
				</template>

				<UAlert
					class="mb-4"
					color="neutral"
					variant="soft"
					icon="i-lucide-id-card"
				>
					<p class="font-medium">
						{{ authorSession.ownershipNotice.title }}
					</p>
					<p class="mt-1 text-sm">
						{{ authorSession.ownershipNotice.body }}
					</p>
				</UAlert>

				<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
					<UFormField
						name="asset"
						label="Graphic Asset source"
						description="One supported image (25 MiB), silent video (250 MiB), or static font (10 MiB)."
						required
					>
						<UFileUpload
							v-model="selectedFile"
							accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,font/woff2,font/woff,font/ttf,font/otf,.png,.jpg,.jpeg,.webp,.mp4,.webm,.woff2,.woff,.ttf,.otf"
							variant="area"
							icon="i-lucide-image-up"
							label="Drop an image, silent video, or static font here"
							description="The exact source bytes are preserved."
						/>
					</UFormField>

					<div class="flex flex-col gap-4">
						<UFormField
							name="name"
							label="Graphic Asset name"
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
							<span>Create a separate Graphic Asset even when this exact Graphic Asset Content already exists.</span>
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
							data-testid="upload-image"
							icon="i-lucide-upload"
							label="Upload and validate"
							:loading="uploadPending"
							:disabled="!canUpload"
							@click="uploadGraphicAsset"
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

				<div class="mt-6 border-t border-default pt-4">
					<h3 class="font-semibold text-highlighted">
						Copy an approved HTTPS source
					</h3>
					<p class="mt-1 text-sm text-muted">
						A one-time bounded copy of a public HTTPS resource. Only public HTTPS destinations are followed, at most three redirects, and the copy leaves no hotlink or dependency on the remote host. Query parameters and fragments are treated as secrets: they are sent once and never stored, so a later retry asks for the URL again.
					</p>
					<div class="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
						<UFormField
							name="remoteSourceUrl"
							label="Public HTTPS source URL"
							description="The remote file name, media type, length, and digest are treated as untrusted hints."
							required
						>
							<UInput
								v-model="remoteSourceUrl"
								data-testid="remote-source-url"
								placeholder="https://cdn.example.com/scoreboard.png"
								class="w-full"
							/>
						</UFormField>
						<div class="flex flex-col gap-4">
							<UFormField
								name="remoteName"
								label="Graphic Asset name"
								description="Searchable library name."
								required
							>
								<UInput
									v-model="remoteProposedName"
									data-testid="remote-source-name"
									placeholder="Remote scoreboard logo"
									class="w-full"
								/>
							</UFormField>
							<label class="flex items-start gap-2 text-sm text-muted">
								<input v-model="remoteCreateSeparateAsset" type="checkbox" class="mt-1">
								<span>Create a separate Graphic Asset even when this exact Graphic Asset Content already exists.</span>
							</label>
							<UAlert
								v-if="remoteSelectionError"
								color="error"
								variant="soft"
								icon="i-lucide-triangle-alert"
								:title="remoteSelectionError"
							/>
							<UButton
								data-testid="copy-remote-source"
								icon="i-lucide-link"
								label="Copy and validate"
								:loading="remoteCopyPending"
								:disabled="!canCopyRemoteSource"
								@click="copyRemoteGraphicAssetSource"
							/>
						</div>
					</div>
					<UAlert
						v-if="remoteCopyError"
						class="mt-4"
						color="error"
						variant="soft"
						icon="i-lucide-circle-x"
						title="Approved remote copy failed"
						:description="remoteCopyError"
					/>
				</div>

				<div v-if="currentOperation" class="mt-4 rounded-lg border border-default bg-elevated/25 p-4">
					<div class="flex flex-wrap items-center gap-2">
						<UBadge
							:color="operationColor(currentOperation.stage)"
							variant="soft"
							:label="currentOperation.stage"
						/>
						<UBadge
							variant="soft"
							color="neutral"
							:label="currentOperation.source === 'remote-copy'
								? 'Approved remote copy'
								: 'Local upload'"
						/>
						<span class="font-mono text-xs text-muted">{{ currentOperation.id }}</span>
					</div>
					<p class="mt-2 text-sm text-muted">
						Transferred {{ formatByteCount(currentOperation.transferredByteLength) }} of
						{{ formatByteCount(currentOperation.declaredByteLength) }} — stage {{ currentOperation.stage }}.
					</p>
					<p v-if="currentOperation.transfer" class="mt-1 text-sm text-muted">
						Verified {{ currentOperation.transfer.completedParts.length }} of
						{{ currentOperation.transfer.partCount }} parts.
					</p>
					<p
						v-if="currentOperation.transfer?.cleanupPending"
						class="mt-1 text-sm text-warning"
					>
						Staged-byte cleanup is pending and will be retried on cancellation.
					</p>
					<p v-if="currentOperation.failure" class="mt-2 text-sm text-error">
						{{ currentOperation.failure.message }}
					</p>
					<p
						v-if="currentOperation.canonicalCapacityOutcome?.outcome === 'no-canonical-growth'"
						class="mt-2 text-sm text-success"
					>
						No canonical growth — existing source and derivative bytes were reused.
					</p>
					<p
						v-else-if="currentOperation.canonicalCapacityOutcome?.outcome === 'canonical-capacity-blocked'"
						class="mt-2 text-sm text-error"
					>
						Blocked: {{ formatByteCount(currentOperation.canonicalCapacityOutcome.growthBytes) }} of canonical growth required with
						{{ formatByteCount(currentOperation.canonicalCapacityOutcome.availableBytes) }} available.
					</p>
					<ul
						v-if="currentOperation.report?.outcome === 'rejected'"
						class="mt-2 list-disc space-y-1 pl-5 text-sm text-error"
					>
						<li v-for="issue in currentOperation.report.issues" :key="issue.code">
							{{ issue.code }} — {{ issue.message }}
						</li>
					</ul>
					<p v-if="awaitingStagedConfirmation" class="mt-2 text-sm text-muted">
						Confirm the exact staged bytes in this browser to finish the copy.
					</p>
					<div class="mt-3 flex flex-wrap gap-2">
						<UButton
							v-if="awaitingStagedConfirmation"
							data-testid="confirm-staged-source"
							icon="i-lucide-badge-check"
							label="Confirm staged source"
							:loading="remoteCopyPending"
							@click="confirmStagedSource"
						/>
						<UButton
							v-if="canRetryOperation"
							icon="i-lucide-refresh-cw"
							:label="currentOperation.stage === 'failed' ? 'Retry from staged bytes' : 'Resume if interrupted'"
							:loading="uploadPending"
							@click="retryOperation"
						/>
						<UButton
							v-if="
								(currentOperation.stage !== 'completed' && currentOperation.stage !== 'cancelled')
									|| currentOperation.transfer?.cleanupPending
							"
							color="error"
							variant="soft"
							icon="i-lucide-x"
							:label="currentOperation.stage === 'cancelled' ? 'Retry staged-byte cleanup' : 'Cancel ingestion'"
							:loading="uploadPending"
							@click="cancelOperation"
						/>
					</div>
					<p v-if="currentOperation.templatePackageInstallation" class="mt-2 text-sm text-muted">
						{{ templatePackageInstallationLabel(currentOperation.templatePackageInstallation) }}
					</p>
					<p v-if="currentOperation.result" class="mt-2 text-sm text-muted">
						{{ operationOutcomeLabel(currentOperation.result.outcome) }} Graphic Asset {{ currentOperation.result.assetId }} Graphic Asset Revision {{ currentOperation.result.revisionId }}
					</p>
					<p
						v-if="
							currentOperation.report?.outcome === 'accepted'
								&& currentOperation.report.facts.kind === 'image'
								&& currentOperation.report.facts.browserDecodable
						"
						class="mt-2 text-sm text-success"
					>
						Exact source browser decode verified before publication.
					</p>
				</div>
			</UCard>

			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="text-lg font-semibold text-highlighted">
						Graphic Assets
					</h2>
					<p class="text-sm text-muted">
						Manage active discovery, reversible retirement, and the 30-day Trash recovery window.
					</p>
				</div>
				<UInput
					v-model="search"
					icon="i-lucide-search"
					placeholder="Search assets"
					class="w-full sm:max-w-sm"
				/>
			</div>
			<div class="flex flex-wrap gap-2" aria-label="Graphic Asset lifecycle view">
				<UButton
					v-for="view in lifecycleViews"
					:key="view.state"
					size="sm"
					:color="lifecycleState === view.state ? 'primary' : 'neutral'"
					:variant="lifecycleState === view.state ? 'solid' : 'outline'"
					:label="view.label"
					@click="lifecycleState = view.state"
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
								<div class="flex flex-wrap gap-2">
									<UBadge color="success" variant="soft" label="Validated" />
									<UBadge
										:color="lifecyclePresentation[asset.lifecycle.state].badgeColor"
										variant="soft"
										:label="lifecyclePresentation[asset.lifecycle.state].label"
									/>
								</div>
							</div>
							<p
								v-if="asset.lifecycle.state === 'trashed'"
								class="mt-2 text-sm text-muted"
							>
								Previously {{ asset.lifecycle.priorState === 'active' ? 'Active' : 'Retired' }} ·
								Recoverable until {{ new Date(asset.lifecycle.recoverableUntil).toLocaleString() }}
							</p>
							<dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
								<div v-if="asset.facts.kind === 'image'">
									<dt class="text-xs text-dimmed">
										Dimensions
									</dt>
									<dd class="text-muted">
										{{ asset.facts.width }} × {{ asset.facts.height }}
									</dd>
								</div>
								<div v-if="asset.facts.kind === 'silent-video'">
									<dt class="text-xs text-dimmed">
										Video
									</dt>
									<dd class="text-muted">
										{{ asset.facts.width }} × {{ asset.facts.height }} · {{ asset.facts.durationSeconds.toFixed(2) }}s · {{ asset.facts.frameRate.toFixed(2) }} fps
									</dd>
								</div>
								<div v-if="asset.facts.kind === 'silent-video'">
									<dt class="text-xs text-dimmed">
										Compatibility
									</dt>
									<dd class="text-muted">
										{{ asset.facts.codec.toUpperCase() }} · 8-bit SDR 4:2:0
										<template v-if="asset.facts.targetCompatibility === 'chromium-transparency'">
											· VP9 alpha restricted to proven Chromium targets
										</template>
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Source
									</dt>
									<dd class="text-muted">
										{{ asset.facts.canonicalMime }} · {{ formatByteCount(asset.facts.byteLength) }}
									</dd>
								</div>
								<div v-if="asset.facts.kind === 'image'">
									<dt class="text-xs text-dimmed">
										Pixels
									</dt>
									<dd class="text-muted">
										{{ asset.facts.pixelCount }}
									</dd>
								</div>
								<div v-if="asset.facts.kind === 'image'">
									<dt class="text-xs text-dimmed">
										Colour
									</dt>
									<dd class="text-muted">
										8-bit {{ asset.facts.colorModel }} · alpha {{ asset.facts.hasAlpha ? 'yes' : 'no' }}
									</dd>
								</div>
								<div v-if="asset.facts.kind === 'font'">
									<dt class="text-xs text-dimmed">
										Verified face
									</dt>
									<dd class="text-muted">
										{{ asset.facts.family }} · {{ asset.facts.weight }} {{ asset.facts.style }}
									</dd>
								</div>
								<div v-if="asset.facts.kind === 'font'">
									<dt class="text-xs text-dimmed">
										Coverage
									</dt>
									<dd class="text-muted">
										{{ asset.facts.glyphCount }} glyphs · {{ asset.facts.unicodeCodePoints.length }} Unicode mappings
									</dd>
								</div>
							</dl>
							<div class="mt-4">
								<h4 class="text-sm font-semibold text-highlighted">
									Revision history
								</h4>
								<ol class="mt-2 space-y-1 text-xs text-muted">
									<li
										v-for="revision in asset.revisions"
										:key="revision.id"
										class="flex flex-wrap justify-between gap-2"
									>
										<span>
											Revision {{ revision.revisionNumber }}
											{{ revision.id === asset.revisionId ? '· Latest' : '' }}
										</span>
										<span class="font-mono">
											{{ revision.id }}
										</span>
									</li>
								</ol>
							</div>
							<p class="mt-3 text-xs text-dimmed">
								Compatibility {{ asset.operation.report?.compatibilityProfile ?? 'unknown' }}
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
							<div class="mt-4 flex flex-wrap gap-2">
								<UButton
									size="sm"
									color="neutral"
									variant="outline"
									label="Inspect exact usage"
									:loading="usagePendingAssetId === asset.id"
									@click="inspectUsage(asset)"
								/>
								<UButton
									v-if="lifecycleAllows(asset, 'retire')"
									size="sm"
									color="neutral"
									variant="outline"
									label="Edit metadata"
									@click="beginMetadataEdit(asset)"
								/>
								<UButton
									v-if="asset.lifecycle.state === 'active'"
									size="sm"
									color="neutral"
									variant="outline"
									label="Replace content"
									@click="beginReplacement(asset)"
								/>
								<UButton
									v-if="asset.lifecycle.state === 'active'"
									size="sm"
									color="warning"
									variant="soft"
									label="Retire"
									:loading="lifecyclePendingAssetId === asset.id"
									@click="runLifecycleAction(asset, 'retire')"
								/>
								<UButton
									v-if="lifecycleAllows(asset, 'trash')"
									size="sm"
									color="error"
									variant="soft"
									label="Move to Trash"
									:loading="lifecyclePendingAssetId === asset.id"
									@click="runLifecycleAction(asset, 'trash')"
								/>
								<UButton
									v-if="lifecycleAllows(asset, 'restore')"
									size="sm"
									color="neutral"
									variant="outline"
									label="Restore"
									:loading="lifecyclePendingAssetId === asset.id"
									@click="runLifecycleAction(asset, 'restore')"
								/>
							</div>
							<UAlert
								v-if="lifecycleErrorByAssetId[asset.id]"
								class="mt-3"
								color="error"
								variant="soft"
							>
								<p>{{ lifecycleErrorByAssetId[asset.id] }}</p>
							</UAlert>
						</div>
					</div>

					<div
						v-if="usageByAssetId[asset.id]"
						class="mt-4 border-t border-default pt-4"
					>
						<h4 class="text-sm font-semibold text-highlighted">
							Exact Graphic Asset Revision usage
						</h4>
						<p
							v-if="usageByAssetId[asset.id]!.length === 0"
							class="mt-2 text-sm text-muted"
						>
							No persisted graphics artifact has a Graphic Asset Reference to any Graphic Asset Revision.
						</p>
						<ul v-else class="mt-2 space-y-2">
							<li
								v-for="usage in usageByAssetId[asset.id]"
								:key="usage.id"
								class="rounded-md border border-default p-3 text-sm"
							>
								<div class="flex flex-wrap items-center justify-between gap-2">
									<span class="font-medium text-highlighted">
										{{ usage.owner.name ?? `${usage.owner.kind} ${usage.owner.id}` }}
									</span>
									<UBadge
										:color="usage.reference.revisionId === asset.revisionId ? 'success' : 'warning'"
										variant="soft"
										:label="usage.reference.revisionId === asset.revisionId ? 'Latest Graphic Asset Revision' : 'Pinned older Graphic Asset Revision'"
									/>
								</div>
								<p class="mt-1 text-muted">
									{{ usage.owner.kind === 'screen' ? 'Screen' : usage.owner.kind }} {{ usage.owner.id }}
									<span v-if="usage.owner.eventId"> · Event {{ usage.owner.eventId }}</span>
									· {{ usage.owner.slot }}
								</p>
								<p class="mt-1 font-mono text-xs text-dimmed">
									Graphic Asset Revision {{ usage.reference.revisionId }}
								</p>
							</li>
						</ul>
					</div>

					<div
						v-if="editingAssetId === asset.id"
						class="mt-4 grid gap-3 border-t border-default pt-4"
					>
						<UFormField name="asset-name" label="Graphic Asset name">
							<UInput v-model="editedName" class="w-full" />
						</UFormField>
						<UFormField
							name="event-associations"
							label="Event associations"
							description="Comma-separated Event IDs. Associations organise discovery and do not change usage."
						>
							<UInput v-model="editedEventIds" class="w-full" />
						</UFormField>
						<UAlert
							v-if="metadataError"
							color="error"
							variant="soft"
							:title="metadataError"
						/>
						<div class="flex gap-2">
							<UButton
								label="Save metadata"
								:loading="metadataPending"
								@click="saveMetadata(asset)"
							/>
							<UButton
								color="neutral"
								variant="ghost"
								label="Cancel"
								@click="editingAssetId = null"
							/>
						</div>
					</div>

					<div
						v-if="replacementAssetId === asset.id"
						class="mt-4 grid gap-3 border-t border-default pt-4"
					>
						<UAlert
							color="warning"
							variant="soft"
							title="Create an immutable Graphic Asset Revision"
							description="Existing Graphic Asset References stay pinned until each owning graphics artifact explicitly selects the newer Graphic Asset Revision."
						/>
						<UFormField
							name="replacement-graphic-asset"
							label="Replacement Graphic Asset source"
							description="Current Graphic Asset Content is a no-op; older or different Graphic Asset Content creates a new Graphic Asset Revision."
						>
							<UFileUpload
								v-model="replacementFile"
								accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,font/woff2,font/woff,font/ttf,font/otf,.png,.jpg,.jpeg,.webp,.mp4,.webm,.woff2,.woff,.ttf,.otf"
								variant="area"
							/>
						</UFormField>
						<UAlert
							v-if="replacementError"
							color="error"
							variant="soft"
							:title="replacementError"
						/>
						<div class="flex gap-2">
							<UButton
								label="Replace with new Graphic Asset Revision"
								:disabled="!replacementFile"
								:loading="replacementPending"
								@click="replaceAsset(asset)"
							/>
							<UButton
								color="neutral"
								variant="ghost"
								label="Cancel"
								@click="replacementAssetId = null"
							/>
						</div>
					</div>

					<template #footer>
						<div class="grid gap-1 font-mono text-xs text-dimmed">
							<span>Operation {{ asset.operation.id }}</span>
							<span>Result {{ JSON.stringify(asset.operation.result) }}</span>
							<span>Graphic Asset {{ asset.id }} · Graphic Asset Revision {{ asset.revisionId }}</span>
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
					Upload a PNG, JPEG, WebP, WOFF2, WOFF, TTF, or OTF source, or change the search.
				</p>
			</div>
		</div>
	</NuxtLayout>
</template>
