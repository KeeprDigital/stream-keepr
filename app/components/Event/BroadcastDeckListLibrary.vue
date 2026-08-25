<script setup lang="ts">
import type { FormError } from '@nuxt/ui';
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
const COLOR_OPTIONS: Array<{ label: DeckColor; value: DeckColor }> = COLORS.map(color => ({ label: color, value: color }));
const EDITOR_FORM_ID = 'broadcast-deck-list-editor-form';

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
const editorLoads = createGuardedSequence();
const editorActions = createGuardedSequence();
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
onBeforeUnmount(() => {
	editorLoads.supersede();
	editorActions.supersede();
	releaseConsumedDetail();
});

function failureRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function presentFailure(cause: unknown, fallback: string): PresentedFailure {
	let cursor: unknown = cause;
	let body: FailureBody | null = null;
	const visited = new Set<unknown>();

	while (cursor && !visited.has(cursor)) {
		visited.add(cursor);
		const record = failureRecord(cursor);
		if (!record)
			break;
		const data = failureRecord(record.data);
		if (data && (typeof data.message === 'string' || failureRecord(data.data))) {
			if (!isSanitizedFailure(cursor))
				body = data as FailureBody;
			break;
		}
		cursor = record.cause;
	}

	const details = body?.data;
	return {
		message: reportedMessage(cause, fallback),
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
		const updated = await eventStore.updateEvent({ broadcastDeckListsEnabled: enabled });
		if (!updated) {
			featureEnabled.value = eventStore.event?.broadcastDeckListsEnabled ?? props.event.broadcastDeckListsEnabled;
			featureFailure.value = {
				message: eventStore.error ?? 'Failed to update Broadcast Deck Lists',
				errors: [],
				retryable: false,
				screens: [],
			};
			return;
		}
		featureEnabled.value = updated.broadcastDeckListsEnabled;
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
	editorLoads.supersede();
	editorActions.supersede();
	editorSaving.value = false;
	releaseConsumedDetail();
	resetDraft();
	editorOpen.value = true;
}

async function startEdit(summary: BroadcastDeckListSummaryResponse) {
	const flight = editorLoads.begin();
	editorActions.supersede();
	editorSaving.value = false;
	releaseConsumedDetail();
	resetDraft();
	editingListId.value = summary.id;
	editingRevision.value = summary.revision;
	editorOpen.value = true;
	releaseDetail.value = deckListStore.consumeDetail(props.event.id, summary.id);
	try {
		const detail = await deckListStore.loadDetail(props.event.id, summary.id);
		if (flight.stale)
			return;
		if (detail)
			applyDetail(detail);
	}
	catch (cause) {
		if (flight.stale)
			return;
		editorFailure.value = presentFailure(cause, 'Failed to load Broadcast Deck List');
	}
}

function closeEditor() {
	editorLoads.supersede();
	editorActions.supersede();
	editorSaving.value = false;
	releaseConsumedDetail();
	editorOpen.value = false;
	resetDraft();
}

function validateDraft(state: Partial<typeof draft>): FormError[] {
	const errors: FormError[] = [];
	if (!state.name?.trim())
		errors.push({ name: 'name', message: 'Name is required' });
	if (!state.sourceText?.trim())
		errors.push({ name: 'sourceText', message: 'Deck List text is required' });
	return errors;
}

async function submitEditor() {
	const authorityRevision = editorFailure.value?.current?.revision;
	await saveEditor(authorityRevision ?? editingRevision.value);
}

async function saveEditor(expectedRevision: number | null) {
	if (editorSaving.value)
		return;

	editorLoads.supersede();
	const flight = editorActions.begin();
	editorSaving.value = true;
	editorFailure.value = null;
	const eventId = props.event.id;
	const listId = editingListId.value;
	const input = {
		name: draft.name.trim(),
		archetypeLabel: draft.archetypeLabel.trim() || null,
		colors: draft.colors.length ? draft.colors.join('') : null,
		sourceText: draft.sourceText,
	};

	try {
		if (listId !== null && expectedRevision !== null) {
			await deckListStore.updateList(eventId, listId, {
				...input,
				expectedRevision,
			});
		}
		else {
			await deckListStore.createList(eventId, input);
		}
		if (flight.stale)
			return;
		closeEditor();
	}
	catch (cause) {
		if (flight.stale)
			return;
		editorFailure.value = presentFailure(cause, 'Failed to save Broadcast Deck List');
	}
	finally {
		if (flight.current)
			editorSaving.value = false;
	}
}

async function reloadLatest() {
	if (editingListId.value === null)
		return;
	editorLoads.supersede();
	const flight = editorActions.begin();
	const listId = editingListId.value;
	editorSaving.value = true;
	try {
		const latest = await deckListStore.loadDetail(props.event.id, listId);
		if (flight.stale)
			return;
		if (latest) {
			applyDetail(latest);
			editorFailure.value = null;
		}
	}
	catch (cause) {
		if (flight.stale)
			return;
		editorFailure.value = presentFailure(cause, 'Failed to load the latest Broadcast Deck List');
	}
	finally {
		if (flight.current)
			editorSaving.value = false;
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
	const expectedRevision = deleteFailure.value?.current?.revision ?? deleteTarget.value.revision;
	deleteSaving.value = true;
	deleteFailure.value = null;
	try {
		await deckListStore.removeList(props.event.id, deleteTarget.value.id, expectedRevision);
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
					Manage the MTG Deck List library available to Deck Screens.
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
			role="alert"
			aria-live="polite"
		/>
		<UAlert
			v-if="collectionFailure"
			color="error"
			variant="soft"
			title="Deck List library could not be loaded"
			:description="collectionFailure"
			role="alert"
			aria-live="polite"
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
				<UForm
					:id="EDITOR_FORM_ID"
					:state="draft"
					:validate="validateDraft"
					class="flex flex-col gap-4"
					@submit="submitEditor"
				>
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
					<UCheckboxGroup
						v-model="draft.colors"
						name="colors"
						legend="Colors (optional, manually classified)"
						:items="COLOR_OPTIONS"
						orientation="horizontal"
					/>
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
						role="alert"
						aria-live="polite"
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
						type="submit"
						:form="EDITOR_FORM_ID"
						:loading="editorSaving"
					/>
					<UButton
						v-else
						:label="editorSaveLabel"
						type="submit"
						:form="EDITOR_FORM_ID"
						:loading="editorSaving"
						:disabled="editorSaving"
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
						role="alert"
						aria-live="polite"
					/>
					<p v-if="deleteFailure?.current" class="text-sm text-muted">
						A newer revision {{ deleteFailure.current.revision }} is available. Retry to delete that authoritative revision.
					</p>
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
						:label="deleteFailure?.current ? 'Retry Delete' : 'Delete Deck List'"
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
