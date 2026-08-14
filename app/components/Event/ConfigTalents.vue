<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Talent } from '~/types';

/** A row of the card: `id` is the talent it came from, absent on one just added. */
interface TalentRow {
	id?: number;
	name: string;
}

const props = defineProps<{
	talents: Talent[];
	loading?: boolean;
}>();

const emit = defineEmits<{
	(e: 'submit', talents: TalentRow[]): void;
}>();

const editingTalents = ref<Set<number>>(new Set());
const editingValues = ref<Record<number, string>>({});

// Computed to check if any talents are being edited
const hasActiveEdits = computed(() => editingTalents.value.size > 0);

// Each row carries the id of the talent it came from, so the save can tell one
// namesake from another and can rename in place instead of replacing the row —
// which would hand the same person a new id and drop their commentator seat. A
// row the operator just added has no talent behind it yet, hence no id.
const { formData: talentsData, isDirty, reset: resetForm } = useForm({
	initialData: computed<TalentRow[]>(() => props.talents.map(t => ({ id: t.id, name: t.name }))),
	onReset: () => {
		// Clear edit states on reset
		editingTalents.value.clear();
		editingValues.value = {};
	},
});

// Register dirty state with page's navigation guard
useRegisterDirtyState(isDirty);

// Computed to determine if save should be disabled
const canSave = computed(() => isDirty.value && !hasActiveEdits.value);

function addTalent() {
	const newTalent: TalentRow = { name: '' };
	talentsData.value.push(newTalent);

	const newIndex = talentsData.value.length - 1;
	startEditing(newIndex);
}

function startEditing(index: number) {
	editingTalents.value.add(index);
	editingValues.value[index] = talentsData.value[index]?.name || '';
}

function stopEditing(index: number) {
	editingTalents.value.delete(index);
	delete editingValues.value[index];
}

function saveTalentEdit(index: number) {
	if (talentsData.value[index] && editingValues.value[index] !== undefined) {
		const trimmedValue = editingValues.value[index].trim();

		if (trimmedValue) {
			talentsData.value[index].name = trimmedValue;
			stopEditing(index);
		}
	}
}

function cancelTalentEdit(index: number) {
	if (talentsData.value[index]) {
		// If this is a new talent (empty name), remove it
		if (!talentsData.value[index].name) {
			removeTalent(index);
		}
		else {
			stopEditing(index);
		}
	}
}

function removeTalent(index: number) {
	if (talentsData.value) {
		talentsData.value.splice(index, 1);
		stopEditing(index);

		// Update edit state indices after removal
		const newEditingTalents = new Set<number>();
		const newEditingValues: Record<number, string> = {};

		editingTalents.value.forEach((editIndex) => {
			if (editIndex > index) {
				newEditingTalents.add(editIndex - 1);
				// Fix: Check if the value exists before using it
				const editValue = editingValues.value[editIndex];
				if (editValue !== undefined) {
					newEditingValues[editIndex - 1] = editValue;
				}
			}
			else if (editIndex < index) {
				newEditingTalents.add(editIndex);
				// Fix: Check if the value exists before using it
				const editValue = editingValues.value[editIndex];
				if (editValue !== undefined) {
					newEditingValues[editIndex] = editValue;
				}
			}
		});

		editingTalents.value = newEditingTalents;
		editingValues.value = newEditingValues;
	}
}

function getDropdownItems(index: number): DropdownMenuItem[] {
	return [
		{
			label: 'Edit Name',
			icon: 'i-lucide-edit',
			onSelect: () => startEditing(index),
		},
		{
			label: 'Remove',
			icon: 'i-lucide-trash-2',
			color: 'error',
			onSelect: () => removeTalent(index),
		},
	];
}

function handleKeydown(event: KeyboardEvent, index: number) {
	if (event.key === 'Enter') {
		event.preventDefault();
		saveTalentEdit(index);
	}
	else if (event.key === 'Escape') {
		event.preventDefault();
		cancelTalentEdit(index);
	}
}

function handleSubmit() {
	if (canSave.value) {
		emit('submit', talentsData.value);
	}
}

defineExpose({ resetForm });
</script>

<template>
	<UCard variant="subtle">
		<UIEmptyState
			v-if="!talentsData.length"
			variant="inline"
			icon="i-lucide-mic"
			title="No talents added yet"
		/>

		<ul v-else role="list" class="divide-y divide-default">
			<li
				v-for="(talent, index) in talentsData"
				:key="index"
				class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
			>
				<div class="flex items-center gap-3 min-w-0 flex-1">
					<!-- Edit Mode -->
					<div v-if="editingTalents.has(index)" class="flex items-center gap-2 flex-1">
						<UInput
							v-model="editingValues[index]"
							placeholder="Enter talent name"
							class="flex-1"
							:ui="{ root: 'flex-1' }"
							autofocus
							@keydown="handleKeydown($event, index)"
						/>
						<div class="flex items-center gap-1">
							<UButton
								icon="i-lucide-check"
								color="success"
								variant="ghost"
								size="xs"
								:disabled="!editingValues[index]?.trim()"
								@click="saveTalentEdit(index)"
							/>
							<UButton
								icon="i-lucide-x"
								color="neutral"
								variant="ghost"
								size="xs"
								@click="cancelTalentEdit(index)"
							/>
						</div>
					</div>

					<!-- Display Mode -->
					<div v-else class="text-sm min-w-0 flex-1">
						<p class="text-highlighted truncate font-medium">
							{{ talent.name }}
						</p>
					</div>
				</div>

				<!-- Actions (only show when not editing) -->
				<div v-if="!editingTalents.has(index)" class="flex items-center gap-3">
					<UDropdownMenu
						:items="getDropdownItems(index)"
						:content="{ align: 'end' }"
					>
						<UButton
							icon="i-lucide-ellipsis-vertical"
							color="neutral"
							variant="ghost"
						/>
					</UDropdownMenu>
				</div>
			</li>
		</ul>

		<template #footer>
			<!--
				This card is not a form. There is no `<form>` or `UForm` above these
				controls and saving runs entirely off the click handler, so every button
				here is an ordinary one. `EventConfigFormFooter`'s Save is a
				`type="submit"` because each of its seven consumers does wrap it in a
				real form; copying that attribute across gives a Save that reads as
				though pressing it submits something and does nothing of the sort (#328).
			-->
			<div class="flex justify-between items-center gap-4">
				<UButton
					label="Reset"
					color="error"
					variant="ghost"
					type="button"
					:disabled="!isDirty"
					@click="resetForm"
				/>
				<UButton
					v-if="!hasActiveEdits"
					label="Add talent"
					icon="i-lucide-plus"
					color="neutral"
					variant="outline"
					type="button"
					@click="addTalent"
				/>
				<UTooltip
					v-if="hasActiveEdits && isDirty"
					text="Complete or cancel active edits before saving"
				>
					<UButton
						label="Save"
						color="primary"
						variant="outline"
						type="button"
						:loading="props.loading"
						:disabled="!canSave"
						@click="handleSubmit"
					/>
				</UTooltip>
				<UButton
					v-else
					label="Save"
					color="primary"
					variant="outline"
					type="button"
					:loading="props.loading"
					:disabled="!canSave"
					@click="handleSubmit"
				/>
			</div>
		</template>
	</UCard>
</template>
