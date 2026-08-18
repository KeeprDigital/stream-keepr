<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { SocialProfiles, SupportedSocialNetwork } from '~~/shared/socialProfiles';
import type { Talent } from '~/types';
import {
	normalizeSocialProfileInput,
	SocialProfileInputError,
	SUPPORTED_SOCIAL_NETWORKS,
} from '~~/shared/socialProfiles';

interface TalentRow {
	id?: number;
	name: string;
	socialProfiles: SocialProfiles;
}

interface TalentEditorValue {
	name: string;
	socialProfiles: Record<SupportedSocialNetwork, string>;
}

const props = defineProps<{
	talents: Talent[];
	loading?: boolean;
}>();

const emit = defineEmits<{
	(e: 'submit', talents: TalentRow[]): void;
}>();

const editingIndex = ref<number | null>(null);
const editingValue = ref<TalentEditorValue | null>(null);
const editingErrors = ref<Partial<Record<'name' | SupportedSocialNetwork, string>>>({});
const hasActiveEdit = computed(() => editingIndex.value !== null);

function rowFromTalent(talent: Talent): TalentRow {
	return {
		id: talent.id,
		name: talent.name,
		socialProfiles: { ...talent.socialProfiles },
	};
}

const { formData: talentsData, isDirty, reset: resetForm } = useForm({
	initialData: computed<TalentRow[]>(() => props.talents.map(rowFromTalent)),
	onReset: closeEditor,
});

useRegisterDirtyState(isDirty);

const canSave = computed(() => isDirty.value && !hasActiveEdit.value);

function editorValue(row: TalentRow): TalentEditorValue {
	return {
		name: row.name,
		socialProfiles: Object.fromEntries(
			SUPPORTED_SOCIAL_NETWORKS.map(network => [network.key, row.socialProfiles[network.key] ?? '']),
		) as Record<SupportedSocialNetwork, string>,
	};
}

function addTalent() {
	talentsData.value.push({ name: '', socialProfiles: {} });
	startEditing(talentsData.value.length - 1);
}

function startEditing(index: number) {
	const row = talentsData.value[index];
	if (!row)
		return;

	editingIndex.value = index;
	editingValue.value = editorValue(row);
	editingErrors.value = {};
}

function closeEditor() {
	editingIndex.value = null;
	editingValue.value = null;
	editingErrors.value = {};
}

function cancelTalentEdit() {
	const index = editingIndex.value;
	if (index !== null && !talentsData.value[index]?.name)
		talentsData.value.splice(index, 1);
	closeEditor();
}

function saveTalentEdit() {
	const index = editingIndex.value;
	const value = editingValue.value;
	if (index === null || !value || !talentsData.value[index])
		return;

	const name = value.name.trim();
	const errors: typeof editingErrors.value = {};
	if (!name)
		errors.name = 'Enter a Talent name';

	const socialProfiles: SocialProfiles = {};
	for (const network of SUPPORTED_SOCIAL_NETWORKS) {
		try {
			const handle = normalizeSocialProfileInput(network.key, value.socialProfiles[network.key]);
			if (handle !== undefined)
				socialProfiles[network.key] = handle;
		}
		catch (error) {
			errors[network.key] = error instanceof SocialProfileInputError
				? error.message
				: 'Invalid Social Profile';
		}
	}

	editingErrors.value = errors;
	if (Object.keys(errors).length > 0)
		return;

	talentsData.value[index] = {
		...talentsData.value[index],
		name,
		socialProfiles,
	};
	closeEditor();
}

function removeTalent(index: number) {
	talentsData.value.splice(index, 1);
	if (editingIndex.value === index)
		closeEditor();
}

function getDropdownItems(index: number): DropdownMenuItem[] {
	return [
		{
			label: 'Edit',
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

function handleSubmit() {
	if (canSave.value)
		emit('submit', talentsData.value);
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
				:key="talent.id ?? `new-${index}`"
				class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
			>
				<div class="text-sm min-w-0 flex-1">
					<p class="text-highlighted truncate font-medium">
						{{ talent.name || 'New Talent' }}
					</p>
					<div v-if="Object.keys(talent.socialProfiles).length" class="mt-1 flex items-center gap-1 text-muted">
						<UIcon
							v-for="network in SUPPORTED_SOCIAL_NETWORKS.filter(item => talent.socialProfiles[item.key])"
							:key="network.key"
							:name="network.icon"
							:aria-label="network.label"
						/>
					</div>
				</div>

				<UDropdownMenu :items="getDropdownItems(index)" :content="{ align: 'end' }">
					<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" />
				</UDropdownMenu>
			</li>
		</ul>

		<template #footer>
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
					label="Add talent"
					icon="i-lucide-plus"
					color="neutral"
					variant="outline"
					type="button"
					:disabled="hasActiveEdit"
					@click="addTalent"
				/>
				<UTooltip v-if="hasActiveEdit && isDirty" text="Complete or cancel the Talent editor before saving">
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

	<UModal
		:open="hasActiveEdit"
		:dismissible="false"
		title="Edit Talent"
		description="Manage the Talent name and optional Social Profiles."
		:close="{ onClick: cancelTalentEdit }"
	>
		<template #body>
			<UForm
				v-if="editingValue"
				:state="editingValue"
				class="flex flex-col gap-4"
				@submit="saveTalentEdit"
			>
				<UFormField label="Name" name="name" :error="editingErrors.name">
					<UInput v-model="editingValue.name" autofocus class="w-full" />
				</UFormField>

				<UFormField
					v-for="network in SUPPORTED_SOCIAL_NETWORKS"
					:key="network.key"
					:label="network.label"
					:name="`socialProfiles.${network.key}`"
					:error="editingErrors[network.key]"
				>
					<UInput
						v-model="editingValue.socialProfiles[network.key]"
						:icon="network.icon"
						:data-social-network="network.key"
						placeholder="Handle or profile URL"
						class="w-full"
					/>
				</UFormField>
			</UForm>
		</template>

		<template #footer>
			<div class="flex justify-end gap-2 w-full">
				<UButton
					label="Cancel"
					color="neutral"
					variant="ghost"
					type="button"
					@click="cancelTalentEdit"
				/>
				<UButton
					label="Done"
					color="primary"
					type="button"
					@click="saveTalentEdit"
				/>
			</div>
		</template>
	</UModal>
</template>
