<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { SocialProfiles, SupportedSocialNetwork } from '~~/shared/socialProfiles';
import type { Talent, UpdateTalentInput } from '~/types';
import {
	normalizeSocialProfileInput,
	SocialProfileInputError,
	SUPPORTED_SOCIAL_NETWORK_KEYS,
	SUPPORTED_SOCIAL_NETWORKS,
} from '~~/shared/socialProfiles';
import { LazyUIConfirmDeleteModal } from '#components';

interface TalentEditorValue {
	name: string;
	socialProfiles: Record<SupportedSocialNetwork, string>;
}

const props = defineProps<{
	talents: Talent[];
}>();

const eventStore = useEventStore();
const overlay = useOverlay();
const { runRequest } = useRequestFeedback();
const deleteModal = overlay.create(LazyUIConfirmDeleteModal);

const editorOpen = ref(false);
/** The Talent the editor is open on; null while adding one. */
const editingTalentId = ref<number | null>(null);
/** The editor as it opened, so a save sends only the fields edited in it. */
const openedValue = shallowRef<TalentEditorValue | null>(null);
const editingValue = ref<TalentEditorValue | null>(null);
const editingErrors = ref<Partial<Record<'name' | SupportedSocialNetwork, string>>>({});
const saving = ref(false);

function editorValue(talent?: Pick<Talent, 'name' | 'socialProfiles'>): TalentEditorValue {
	return {
		name: talent?.name ?? '',
		socialProfiles: Object.fromEntries(
			SUPPORTED_SOCIAL_NETWORKS.map(network => [network.key, talent?.socialProfiles[network.key] ?? '']),
		) as Record<SupportedSocialNetwork, string>,
	};
}

function openEditor(talent?: Talent) {
	editingTalentId.value = talent?.id ?? null;
	openedValue.value = editorValue(talent);
	editingValue.value = editorValue(talent);
	editingErrors.value = {};
	editorOpen.value = true;
}

function closeEditor() {
	editorOpen.value = false;
	editingTalentId.value = null;
	openedValue.value = null;
	editingValue.value = null;
	editingErrors.value = {};
}

function cancelTalentEdit() {
	if (!saving.value)
		closeEditor();
}

/** The editor's value, normalized, or null with each complaint shown at its field. */
function parseEditor(value: TalentEditorValue): { name: string; socialProfiles: SocialProfiles } | null {
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
	return Object.keys(errors).length > 0
		? null
		: { name, socialProfiles };
}

/**
 * What the editor changed on `current`. A field left as the editor opened keeps
 * the Talent's current value, which a colleague's change may have moved meanwhile
 * (#612).
 */
function editedFields(current: Talent, opened: TalentEditorValue, value: TalentEditorValue, parsed: { name: string; socialProfiles: SocialProfiles }): UpdateTalentInput {
	const update: UpdateTalentInput = {};
	if (value.name !== opened.name && parsed.name !== current.name)
		update.name = parsed.name;

	const socialProfiles: SocialProfiles = {};
	for (const network of SUPPORTED_SOCIAL_NETWORKS) {
		const handle = value.socialProfiles[network.key] === opened.socialProfiles[network.key]
			? current.socialProfiles[network.key]
			: parsed.socialProfiles[network.key];
		if (handle !== undefined)
			socialProfiles[network.key] = handle;
	}
	if (SUPPORTED_SOCIAL_NETWORK_KEYS.some(network => socialProfiles[network] !== current.socialProfiles[network]))
		update.socialProfiles = socialProfiles;

	return update;
}

async function saveTalentEdit() {
	const opened = openedValue.value;
	const value = editingValue.value;
	if (saving.value || !opened || !value)
		return;

	const parsed = parseEditor(value);
	if (!parsed)
		return;

	// A Talent a colleague removed while the editor was open is created again.
	const current = props.talents.find(talent => talent.id === editingTalentId.value);
	const update = current && editedFields(current, opened, value, parsed);
	if (update && Object.keys(update).length === 0) {
		closeEditor();
		return;
	}

	saving.value = true;
	try {
		const saved = await runRequest(
			() => current && update
				? eventStore.updateTalent(current.id, update)
				: eventStore.addTalent(parsed),
			{
				error: failure => ({
					title: 'Talent not saved',
					description: eventStore.error ?? failure.message,
					color: 'error',
				}),
			},
		);
		if (saved)
			closeEditor();
	}
	finally {
		saving.value = false;
	}
}

async function confirmRemove(talent: Talent) {
	const confirmed = await deleteModal.open({
		title: 'Delete Talent',
		itemName: talent.name,
	}).result;
	if (!confirmed)
		return;

	await runRequest(() => eventStore.removeTalent(talent.id), {
		error: failure => ({
			title: 'Talent not deleted',
			description: eventStore.error ?? failure.message,
			color: 'error',
		}),
	});
}

function getDropdownItems(talent: Talent): DropdownMenuItem[] {
	return [
		{
			label: 'Edit',
			icon: 'i-lucide-edit',
			onSelect: () => openEditor(talent),
		},
		{
			label: 'Delete',
			icon: 'i-lucide-trash-2',
			color: 'error',
			onSelect: () => {
				void confirmRemove(talent);
			},
		},
	];
}
</script>

<template>
	<UCard variant="subtle">
		<UIEmptyState
			v-if="!talents.length"
			variant="inline"
			icon="i-lucide-mic"
			title="No talents added yet"
		/>

		<ul v-else role="list" class="divide-y divide-default">
			<li
				v-for="talent in talents"
				:key="talent.id"
				class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
			>
				<div class="text-sm min-w-0 flex-1">
					<p class="text-highlighted truncate font-medium">
						{{ talent.name }}
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

				<UDropdownMenu :items="getDropdownItems(talent)" :content="{ align: 'end' }">
					<UButton
						icon="i-lucide-ellipsis-vertical"
						color="neutral"
						variant="ghost"
						:aria-label="`${talent.name} actions`"
					/>
				</UDropdownMenu>
			</li>
		</ul>

		<template #footer>
			<div class="flex justify-end">
				<UButton
					label="Add Talent"
					icon="i-lucide-plus"
					color="neutral"
					variant="outline"
					type="button"
					@click="openEditor()"
				/>
			</div>
		</template>
	</UCard>

	<UModal
		:open="editorOpen"
		:dismissible="false"
		:title="editingTalentId === null ? 'Add Talent' : 'Edit Talent'"
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
					:disabled="saving"
					@click="cancelTalentEdit"
				/>
				<UButton
					label="Save"
					color="primary"
					type="button"
					:loading="saving"
					@click="saveTalentEdit"
				/>
			</div>
		</template>
	</UModal>
</template>
