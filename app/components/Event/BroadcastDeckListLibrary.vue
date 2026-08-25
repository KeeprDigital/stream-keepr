<script setup lang="ts">
import type {
	BroadcastDeckListImportFailureDetail,
	BroadcastDeckListResponse,
	BroadcastDeckListSummaryResponse,
} from '~~/shared/types/broadcastDeckList';
import type { Event } from '~/types';

const props = defineProps<{
	event: Event;
}>();

interface FailureBody {
	message?: string;
	data?: {
		code?: string;
		errors?: BroadcastDeckListImportFailureDetail[];
		current?: BroadcastDeckListResponse;
		retryable?: boolean;
		screens?: { id: number; name: string }[];
	};
}

interface PresentedFailure {
	message: string;
	code?: string;
	errors: BroadcastDeckListImportFailureDetail[];
	current?: BroadcastDeckListResponse;
	retryable: boolean;
	screens: { id: number; name: string }[];
}

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
type DeckColor = typeof COLORS[number];

const deckListStore = useBroadcastDeckListStore();
const eventStore = useEventStore();

const featureEnabled = ref(props.event.broadcastDeckListsEnabled);
const featureSaving = ref(false);
const featureFailure = ref<PresentedFailure | null>(null);
const collectionFailure = ref<string | null>(null);

const editorOpen = ref(false);
const editingListId = ref<number | null>(null);
const editingRevision = ref<number | null>(null);
const editorSaving = ref(false);
const editorFailure = ref<PresentedFailure | null>(null);
const releaseDetail = ref<null | (() => void)>(null);
const draft = reactive({
	name: '',
	archetypeLabel: '',
	sourceText: '',
	colors: [] as DeckColor[],
});

const deleteTarget = ref<BroadcastDeckListSummaryResponse | null>(null);
const deleteOpen = computed({
	get: () => deleteTarget.value !== null,
	set: (open: boolean) => {
		if (!open)
			closeDelete();
	},
});
const deleteSaving = ref(false);
const deleteFailure = ref<PresentedFailure | null>(null);

const isEditing = computed(() => editingListId.value !== null);
const editorTitle = computed(() => isEditing.value ? 'Edit Deck List' : 'Add Deck List');
const editorSaveLabel = computed(() => isEditing.value ? 'Save Changes' : 'Save Deck List');

watch(() => props.event.broadcastDeckListsEnabled, (enabled) => {
	featureEnabled.value = enabled;
});

watch(() => props.event.id, async (eventId) => {
	closeEditor();
	closeDelete();
	await loadCollection(eventId);
});

onMounted(() => loadCollection(props.event.id));
onBeforeUnmount(() => releaseConsumedDetail());

function failureRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function presentFailure(cause: unknown, fallback: string): PresentedFailure {
	let cursor: unknown = cause;
	let body: FailureBody | null = null;
	let message = cause instanceof Error ? cause.message : fallback;
	const visited = new Set<unknown>();

	while (cursor && !visited.has(cursor)) {
		visited.add(cursor);
		const record = failureRecord(cursor);
		if (!record)
			break;
		const data = failureRecord(record.data);
		if (data && (typeof data.message === 'string' || failureRecord(data.data))) {
			body = data as FailureBody;
			break;
		}
		cursor = record.cause;
	}

	if (body?.message)
		message = body.message;
	const details = body?.data;
	return {
		message,
		code: details?.code,
		errors: Array.isArray(details?.errors) ? details.errors : [],
		current: details?.current,
		retryable: details?.retryable === true,
		screens: Array.isArray(details?.screens) ? details.screens : [],
	};
}

function formattedImportError(error: BroadcastDeckListImportFailureDetail) {
	const location = error.lineNumber === undefined ? '' : `Line ${error.lineNumber}: `;
	const source = error.sourceText ? ` — ${error.sourceText}` : '';
	return `${location}${error.message}${source}`;
}

async function loadCollection(eventId: number) {
	collectionFailure.value = null;
	try {
		await deckListStore.loadCollection(eventId);
	}
	catch (cause) {
		collectionFailure.value = presentFailure(cause, 'Failed to load Broadcast Deck Lists').message;
	}
}

async function toggleFeature(enabled: boolean) {
	if (featureSaving.value)
		return;
	featureSaving.value = true;
	featureFailure.value = null;
	try {
		await eventStore.updateEvent({ broadcastDeckListsEnabled: enabled });
		featureEnabled.value = enabled;
	}
	catch (cause) {
		featureFailure.value = presentFailure(cause, 'Failed to update Broadcast Deck Lists');
	}
	finally {
		featureSaving.value = false;
	}
}

function resetDraft() {
	draft.name = '';
	draft.archetypeLabel = '';
	draft.sourceText = '';
	draft.colors = [];
	editingListId.value = null;
	editingRevision.value = null;
	editorFailure.value = null;
}

function applyDetail(detail: BroadcastDeckListResponse) {
	draft.name = detail.name;
	draft.archetypeLabel = detail.archetypeLabel ?? '';
	draft.sourceText = detail.sourceText;
	draft.colors = COLORS.filter(color => detail.colors?.includes(color));
	editingRevision.value = detail.revision;
}

function releaseConsumedDetail() {
	releaseDetail.value?.();
	releaseDetail.value = null;
}

function startAdd() {
	releaseConsumedDetail();
	resetDraft();
	editorOpen.value = true;
}

async function startEdit(summary: BroadcastDeckListSummaryResponse) {
	releaseConsumedDetail();
	resetDraft();
	editingListId.value = summary.id;
	editingRevision.value = summary.revision;
	editorOpen.value = true;
	releaseDetail.value = deckListStore.consumeDetail(props.event.id, summary.id);
	try {
		const detail = await deckListStore.loadDetail(props.event.id, summary.id);
		if (detail)
			applyDetail(detail);
	}
	catch (cause) {
		editorFailure.value = presentFailure(cause, 'Failed to load Broadcast Deck List');
	}
}

function closeEditor() {
	releaseConsumedDetail();
	editorOpen.value = false;
	resetDraft();
}

function toggleColor(color: DeckColor, selected: boolean) {
	draft.colors = selected
		? COLORS.filter(value => value === color || draft.colors.includes(value))
		: draft.colors.filter(value => value !== color);
}

function validateDraft() {
	const errors: BroadcastDeckListImportFailureDetail[] = [];
	if (!draft.name.trim())
		errors.push({ code: 'NAME_REQUIRED', message: 'Name is required' });
	if (!draft.sourceText.trim())
		errors.push({ code: 'SOURCE_REQUIRED', message: 'Deck List text is required' });
	return errors;
}

async function saveEditor(expectedRevision = editingRevision.value) {
	if (editorSaving.value)
		return;
	const validationErrors = validateDraft();
	if (validationErrors.length) {
		editorFailure.value = {
			message: 'Complete the required Deck List fields',
			errors: validationErrors,
			retryable: false,
			screens: [],
		};
		return;
	}

	editorSaving.value = true;
	editorFailure.value = null;
	const input = {
		name: draft.name.trim(),
		archetypeLabel: draft.archetypeLabel.trim() || null,
		colors: draft.colors.length ? draft.colors.join('') : null,
		sourceText: draft.sourceText,
	};

	try {
		if (editingListId.value !== null && expectedRevision !== null) {
			await deckListStore.updateList(props.event.id, editingListId.value, {
				...input,
				expectedRevision,
			});
		}
		else {
			await deckListStore.createList(props.event.id, input);
		}
		closeEditor();
	}
	catch (cause) {
		editorFailure.value = presentFailure(cause, 'Failed to save Broadcast Deck List');
	}
	finally {
		editorSaving.value = false;
	}
}

async function retrySave() {
	const authorityRevision = editorFailure.value?.current?.revision;
	await saveEditor(authorityRevision ?? editingRevision.value);
}

async function reloadLatest() {
	if (editingListId.value === null)
		return;
	try {
		const latest = await deckListStore.loadDetail(props.event.id, editingListId.value);
		if (latest) {
			applyDetail(latest);
			editorFailure.value = null;
		}
	}
	catch (cause) {
		editorFailure.value = presentFailure(cause, 'Failed to load the latest Broadcast Deck List');
	}
}

function openDelete(summary: BroadcastDeckListSummaryResponse) {
	deleteFailure.value = null;
	deleteTarget.value = summary;
}

function closeDelete() {
	deleteTarget.value = null;
	deleteFailure.value = null;
}

async function confirmDelete() {
	if (!deleteTarget.value || deleteSaving.value)
		return;
	deleteSaving.value = true;
	deleteFailure.value = null;
	try {
		await deckListStore.removeList(props.event.id, deleteTarget.value.id, deleteTarget.value.revision);
		closeDelete();
	}
	catch (cause) {
		deleteFailure.value = presentFailure(cause, 'Failed to delete Broadcast Deck List');
	}
	finally {
		deleteSaving.value = false;
	}
}
</script>

<template>
	<section v-if="props.event.game === 'mtg'" class="flex flex-col gap-4">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h2 class="text-xl font-semibold">
					Broadcast Deck Lists
				</h2>
				<p class="text-sm text-muted">
					Manage the MTG Deck List library available to Broadcast Screens.
				</p>
			</div>
			<div class="flex items-center gap-3">
				<span class="text-sm font-medium">Enable for Broadcast</span>
				<USwitch
					:model-value="featureEnabled"
					:disabled="featureSaving"
					aria-label="Enable Broadcast Deck Lists"
					@update:model-value="toggleFeature"
				/>
			</div>
		</div>

		<UAlert
			v-if="featureFailure"
			color="error"
			variant="soft"
			title="Broadcast Deck Lists were not changed"
			:description="featureFailure.message"
		/>
		<UAlert
			v-if="collectionFailure"
			color="error"
			variant="soft"
			title="Deck List library could not be loaded"
			:description="collectionFailure"
		/>

		<UCard>
			<template #header>
				<div class="flex items-center justify-between gap-4">
					<div>
						<h3 class="font-semibold">
							Library
						</h3>
						<p v-if="!featureEnabled" class="text-sm text-muted">
							The library remains editable while Broadcast Deck Lists are disabled.
						</p>
					</div>
					<UButton
						label="Add Deck List"
						icon="i-lucide-plus"
						@click="startAdd"
					/>
				</div>
			</template>

			<div v-if="deckListStore.loading" class="py-8 text-center text-muted">
				Loading Deck Lists…
			</div>
			<div v-else-if="deckListStore.summaries.length === 0" class="py-8 text-center text-muted">
				No Broadcast Deck Lists yet.
			</div>
			<ul v-else class="divide-y divide-muted">
				<li
					v-for="item in deckListStore.summaries"
					:key="item.id"
					class="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
				>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium">{{ item.name }}</span>
							<UBadge v-if="item.archetypeLabel" color="neutral" variant="soft">
								{{ item.archetypeLabel }}
							</UBadge>
							<UBadge v-if="item.colors" color="neutral" variant="outline">
								{{ item.colors }}
							</UBadge>
						</div>
						<p class="mt-1 text-sm text-muted">
							{{ item.mainboardQuantity }} mainboard · {{ item.sideboardQuantity }} sideboard
							<span v-if="item.hasCompanion"> · Companion</span>
							· Revision {{ item.revision }}
						</p>
					</div>
					<div class="flex items-center gap-2">
						<UButton
							:label="`Edit ${item.name}`"
							color="neutral"
							variant="outline"
							icon="i-lucide-pencil"
							@click="startEdit(item)"
						/>
						<UButton
							:label="`Delete ${item.name}`"
							color="error"
							variant="ghost"
							icon="i-lucide-trash-2"
							@click="openDelete(item)"
						/>
					</div>
				</li>
			</ul>
		</UCard>

		<UModal
			:open="editorOpen"
			:dismissible="false"
			:title="editorTitle"
			description="Set the metadata and paste the complete plaintext Deck List."
			:close="{ onClick: closeEditor }"
		>
			<template #body>
				<UForm :state="draft" class="flex flex-col gap-4" @submit="saveEditor()">
					<UFormField label="Name" name="name" required>
						<UInput
							v-model="draft.name"
							name="name"
							autofocus
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Archetype label" name="archetypeLabel" hint="Optional">
						<UInput v-model="draft.archetypeLabel" name="archetypeLabel" class="w-full" />
					</UFormField>
					<UFormField label="Colors" name="colors" hint="Optional, manually classified">
						<div class="flex flex-wrap gap-3">
							<UCheckbox
								v-for="color in COLORS"
								:key="color"
								:model-value="draft.colors.includes(color)"
								:label="color"
								@update:model-value="selected => toggleColor(color, selected === true)"
							/>
						</div>
					</UFormField>
					<UFormField label="Deck List text" name="sourceText" required>
						<UTextarea
							v-model="draft.sourceText"
							name="sourceText"
							:rows="14"
							class="w-full font-mono"
							placeholder="4 Card Name\n56 Card Name\nSideboard\n15 Card Name"
						/>
					</UFormField>

					<UAlert
						v-if="editorFailure"
						color="error"
						variant="soft"
						:description="editorFailure.message"
					>
						<template #title>
							<span v-if="editorFailure.current">
								A newer revision {{ editorFailure.current.revision }} is available
							</span>
							<span v-else>Deck List could not be saved</span>
						</template>
						<template v-if="editorFailure.errors.length" #description>
							<ul class="list-disc space-y-1 pl-5">
								<li v-for="error in editorFailure.errors" :key="`${error.lineNumber}-${error.code}-${error.sourceText}`">
									{{ formattedImportError(error) }}
								</li>
							</ul>
						</template>
					</UAlert>
				</UForm>
			</template>

			<template #footer>
				<div class="flex w-full flex-wrap justify-end gap-2">
					<UButton
						label="Cancel"
						color="neutral"
						variant="ghost"
						:disabled="editorSaving"
						@click="closeEditor"
					/>
					<UButton
						v-if="editorFailure?.current"
						label="Reload Latest"
						color="neutral"
						variant="outline"
						:disabled="editorSaving"
						@click="reloadLatest"
					/>
					<UButton
						v-if="editorFailure?.retryable || editorFailure?.current"
						label="Retry Save"
						color="warning"
						variant="outline"
						:loading="editorSaving"
						@click="retrySave"
					/>
					<UButton
						:label="editorSaveLabel"
						:loading="editorSaving"
						:disabled="editorSaving"
						@click="saveEditor()"
					/>
				</div>
			</template>
		</UModal>

		<UModal
			v-model:open="deleteOpen"
			:dismissible="false"
			title="Delete Deck List"
			:description="deleteTarget ? `Delete ${deleteTarget.name} from this Event?` : undefined"
		>
			<template #body>
				<div class="space-y-4">
					<p class="text-muted">
						This permanently deletes the saved Deck List.
					</p>
					<UAlert
						v-if="deleteFailure"
						color="error"
						variant="soft"
						title="Deck List was not deleted"
						:description="deleteFailure.screens.length ? `${deleteFailure.message} (${deleteFailure.screens.map(screen => screen.name).join(', ')})` : deleteFailure.message"
					/>
				</div>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						label="Cancel"
						color="neutral"
						variant="ghost"
						:disabled="deleteSaving"
						@click="closeDelete"
					/>
					<UButton
						label="Delete Deck List"
						color="error"
						:loading="deleteSaving"
						:disabled="deleteSaving"
						@click="confirmDelete"
					/>
				</div>
			</template>
		</UModal>
	</section>
</template>
