<script setup lang="ts">
import { LazyUIConfirmDeleteModal } from '#components';

const props = defineProps<{
	listId: number;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'deleted', listId: number): void;
}>();

const eventStore = useEventStore();
const playerStore = usePlayerStore();
const playerListStore = usePlayerListStore();
const overlay = useOverlay();
const { runRequest } = useRequestFeedback();

// ── List data from store (reactive) ──

const list = computed(() => playerListStore.lists.find(l => l.id === props.listId));
const allPlayers = computed(() => playerStore.players);

// ── Name editing ──

const listName = ref(list.value?.name ?? '');
const originalName = ref(list.value?.name ?? '');
const formState = reactive({ listName });
const nameIsDirty = computed(() => listName.value.trim() !== originalName.value);
const nameIsValid = computed(() => listName.value.trim().length > 0);

// ── Members pane ref ──

const membersPane = ref<{ hasChanges: boolean; save: () => Promise<void>; reset: () => void; saving: boolean } | null>(null);

const membersHaveChanges = computed(() => membersPane.value?.hasChanges ?? false);
const membersSaving = computed(() => membersPane.value?.saving ?? false);

// ── Combined dirty state ──

const isDirty = computed(() => nameIsDirty.value || membersHaveChanges.value);

// ── Load member IDs on mount ──

const memberIds = ref<number[]>([]);
const loading = ref(false);

onMounted(async () => {
	if (!eventStore.eventId)
		return;

	loading.value = true;
	try {
		if (!playerListStore.getCachedMemberIds(props.listId)) {
			await playerListStore.loadListMembers(eventStore.eventId, props.listId);
		}
		memberIds.value = playerListStore.getCachedMemberIds(props.listId) ?? [];
	}
	finally {
		loading.value = false;
	}
});

// ── Save ──

const saving = ref(false);
const formId = `edit-player-list-${props.listId}-form`;

async function handleSave() {
	const eventId = eventStore.eventId;
	if (!eventId || !isDirty.value)
		return;

	await runRequest(async () => {
		// Save name if changed
		if (nameIsDirty.value && nameIsValid.value) {
			const updated = await playerListStore.updateList(eventId, props.listId, { name: listName.value.trim() });
			if (!updated)
				throw new Error('Failed to update the list name');
			originalName.value = listName.value.trim();
		}

		// Save members if changed
		if (membersHaveChanges.value && membersPane.value) {
			await membersPane.value.save();
		}

		return true;
	}, {
		loadingRef: saving,
		success: { title: 'List updated', color: 'success' },
		error: { title: 'Failed to update list', color: 'error' },
		onSuccess: () => {
			emit('close');
		},
	});
}

// ── Reset ──

function handleReset() {
	listName.value = originalName.value;
	membersPane.value?.reset();
}

// ── Delete ──

const deleting = ref(false);

async function handleDelete() {
	if (!eventStore.eventId || !list.value)
		return;

	const deleteModal = overlay.create(LazyUIConfirmDeleteModal);
	const confirmed = await deleteModal.open({
		title: 'Delete List',
		itemName: list.value.name,
	}).result;

	if (!confirmed)
		return;

	await runRequest(
		() => playerListStore.removeList(eventStore.eventId!, props.listId),
		{
			loadingRef: deleting,
			success: { title: 'List deleted', color: 'success' },
			error: { title: 'Failed to delete list', color: 'error' },
			onSuccess: () => {
				emit('deleted', props.listId);
				emit('close');
			},
		},
	);
}

// ── Footer Menu ──

const footerMenuItems = computed(() => [[
	{
		label: 'Delete List',
		icon: 'i-lucide-trash-2',
		color: 'error' as const,
		loading: deleting.value,
		onSelect: handleDelete,
	},
]]);

// ── Close ──

function handleClose() {
	emit('close');
}
</script>

<template>
	<UModal
		open
		:dismissible="false"
		title="Edit List"
		:close="{ onClick: handleClose }"
		:ui="{ content: 'sm:max-w-4xl' }"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formState"
				class="flex flex-col gap-4"
				@submit="handleSave"
			>
				<!-- Name field -->
				<UFormField label="List Name">
					<UInput
						v-model="listName"
						placeholder="List name"
						class="w-full"
					/>
				</UFormField>

				<!-- Members pane -->
				<div v-if="loading" class="flex items-center justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
				</div>
				<PlayerListMembersPane
					v-else
					ref="membersPane"
					:list-id="listId"
					:all-players="allPlayers"
					:initial-member-ids="memberIds"
				/>
			</UForm>
		</template>

		<template #footer>
			<div class="flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
				<UButton
					label="Reset"
					color="error"
					variant="ghost"
					:disabled="!isDirty"
					@click="handleReset"
				/>
				<div class="flex items-center justify-end gap-2">
					<UButton
						type="submit"
						:form="formId"
						label="Save"
						color="primary"
						:loading="saving || membersSaving"
						:disabled="!isDirty || !nameIsValid"
					/>
					<UDropdownMenu
						:items="footerMenuItems"
						:content="{ align: 'end' }"
					>
						<UButton
							icon="i-lucide-ellipsis-vertical"
							color="neutral"
							variant="ghost"
							aria-label="More actions"
						/>
					</UDropdownMenu>
				</div>
			</div>
		</template>
	</UModal>
</template>
