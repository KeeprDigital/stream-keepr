<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { SocialProfiles, SupportedSocialNetwork } from '~~/shared/socialProfiles';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { CreateTalentInput, Talent, UpdateTalentInput } from '~/types';
import {
	normalizeSocialProfileInput,
	SocialProfileInputError,
	SUPPORTED_SOCIAL_NETWORK_KEYS,
	SUPPORTED_SOCIAL_NETWORKS,
} from '~~/shared/socialProfiles';
import { LazyUIConfirmDeleteModal } from '#components';

interface TalentEditorValue {
	name: string;
	/** Free text such as "Host"; blank is none. */
	role: string;
	socialProfiles: Record<SupportedSocialNetwork, string>;
	/** One exact image revision from the Graphics Asset Library, or none (ADR-0067). */
	photo: GraphicAssetReference | null;
}

const props = defineProps<{
	talents: Talent[];
	/** The Event whose adopted assets the photo picker offers first. */
	eventId: number;
}>();

/** The exact revision's bytes: the thumbnail shows what the Talent holds, not the asset's latest. */
function photoSource(photo: GraphicAssetReference) {
	return `/api/graphics-assets/${encodeURIComponent(photo.assetId)}/revisions/${encodeURIComponent(photo.revisionId)}/content`;
}

function samePhoto(a: GraphicAssetReference | null, b: GraphicAssetReference | null) {
	return a?.assetId === b?.assetId && a?.revisionId === b?.revisionId;
}

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

function editorValue(talent?: Pick<Talent, 'name' | 'role' | 'socialProfiles' | 'photo'>): TalentEditorValue {
	return {
		name: talent?.name ?? '',
		role: talent?.role ?? '',
		socialProfiles: Object.fromEntries(
			SUPPORTED_SOCIAL_NETWORKS.map(network => [network.key, talent?.socialProfiles[network.key] ?? '']),
		) as Record<SupportedSocialNetwork, string>,
		photo: talent?.photo ?? null,
	};
}

/** The picker's choice, or its Clear. */
function choosePhoto(photo: GraphicAssetReference | undefined) {
	if (editingValue.value)
		editingValue.value.photo = photo ?? null;
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

interface ParsedTalent {
	name: string;
	role: string | null;
	socialProfiles: SocialProfiles;
}

/** The editor's value, normalized, or null with each complaint shown at its field. */
function parseEditor(value: TalentEditorValue): ParsedTalent | null {
	const name = value.name.trim();
	const role = value.role.trim() || null;
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
		: { name, role, socialProfiles };
}

/**
 * What the editor changed on `current`. A field left as the editor opened keeps
 * the Talent's current value, which a colleague's change may have moved meanwhile
 * (#612).
 */
function editedFields(current: Talent, opened: TalentEditorValue, value: TalentEditorValue, parsed: ParsedTalent): UpdateTalentInput {
	const update: UpdateTalentInput = {};
	if (value.name !== opened.name && parsed.name !== current.name)
		update.name = parsed.name;
	if (value.role !== opened.role && parsed.role !== (current.role ?? null))
		update.role = parsed.role;

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

	if (!samePhoto(value.photo, opened.photo) && !samePhoto(value.photo, current.photo))
		update.photo = value.photo;

	return update;
}

/** A new Talent's fields: a role or photo only when it has one. */
function createdTalent({ role, ...parsed }: ParsedTalent, photo: GraphicAssetReference | null): CreateTalentInput {
	return {
		name: parsed.name,
		...(role
			? { role }
			: {}),
		socialProfiles: parsed.socialProfiles,
		...(photo
			? { photo }
			: {}),
	};
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
				: eventStore.addTalent(createdTalent(parsed, value.photo)),
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
				<div
					class="size-10 shrink-0 overflow-hidden rounded-full bg-elevated flex items-center justify-center"
					:data-talent-photo="talent.photo?.revisionId ?? 'none'"
				>
					<img
						v-if="talent.photo"
						:src="photoSource(talent.photo)"
						:alt="`${talent.name} photo`"
						class="size-full object-cover"
					>
					<UIcon v-else name="i-lucide-user" class="text-muted" />
				</div>
				<div class="text-sm min-w-0 flex-1">
					<p class="text-highlighted truncate font-medium">
						{{ talent.name }}
						<span v-if="talent.role" class="text-muted font-normal" data-talent-role>{{ talent.role }}</span>
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
		description="Manage the Talent name, role, optional photo and Social Profiles."
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

				<UFormField label="Role" name="role" description="Shown on a Talent Screen, such as Host or Commentator.">
					<UInput v-model="editingValue.role" placeholder="None" class="w-full" />
				</UFormField>

				<UFormField label="Photo" name="photo">
					<div class="flex items-start gap-3">
						<img
							v-if="editingValue.photo"
							:src="photoSource(editingValue.photo)"
							alt="Talent photo"
							class="size-16 shrink-0 rounded-md object-cover bg-elevated"
						>
						<GraphicsAssetFocusPicker
							:model-value="editingValue.photo ?? undefined"
							:event-id="eventId"
							field-label="Talent photo"
							asset-kind="image"
							@update:model-value="choosePhoto"
						/>
					</div>
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
