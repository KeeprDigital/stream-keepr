<script setup lang="ts">
import type { BroadcastGraphicTemplateSummary } from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';

/**
 * The Broadcast Graphic Template library, as an author browses and manages it.
 *
 * The library is installation-scoped, so this is the same library from every
 * Event's Edit workspace — which is what makes a design saved during one show
 * placeable in the next without anything being copied between Events.
 *
 * It belongs to authoring surfaces only. A live operator runs a show through Take,
 * Update Graphic, and Out on the graphics the Screen already carries; placing,
 * saving, renaming, or deleting a design is authoring, and offering any of it in
 * Live Control would put a structural change to the Screen one click away from an
 * operator working a live programme.
 *
 * Placement and saving are server operations rather than local edits. The server
 * builds the copy and writes it through the Screen's own configuration path, so the
 * placed Broadcast Graphic is validated, capped, indexed, and published exactly as a
 * hand-authored one — and the Screen is then reloaded authoritatively rather than
 * patched from a guess.
 */
const props = defineProps<{
	eventId: number;
	screenId: number;
	/** The Broadcast Graphic an author can save, when the Edit workspace has one selected. */
	selectedGraphic?: BroadcastGraphicConfig | null;
	/**
	 * Whether this session may author. A session observing a Screen another session's
	 * Graphics Authoring Lease covers still browses the library, because looking
	 * through the available designs corrupts nothing.
	 */
	writable?: boolean;
}>();

const emit = defineEmits<{ placed: [graphicId: string] }>();

const repository = useBroadcastGraphicTemplateRepository();
const screenStore = useScreenStore();

const templates = ref<BroadcastGraphicTemplateSummary[]>([]);
const loading = ref(false);
const busyTemplateId = ref<string | null>(null);
const saving = ref(false);
const error = ref<string | null>(null);
/** The template whose deletion is awaiting confirmation, if any. */
const pendingDeleteId = ref<string | null>(null);

/** Fail closed: an unstated permission is never permission. */
const canAuthor = computed(() => props.writable === true);
const canSave = computed(() => canAuthor.value && !!props.selectedGraphic && !saving.value);

function failureMessage(caught: unknown): string {
	const data = (caught as { data?: { message?: string } })?.data;
	if (typeof data?.message === 'string' && data.message.length > 0)
		return data.message;
	return caught instanceof Error ? caught.message : 'The Broadcast Graphic Template library is unavailable';
}

/**
 * Re-read the library.
 *
 * `keepError` exists for the one case that matters: a refused write re-reads the
 * library so the author is looking at what actually exists, and a successful re-read
 * must not then erase the message explaining why their write was refused.
 */
async function refresh(keepError = false) {
	loading.value = true;
	try {
		templates.value = await repository.list();
		if (!keepError)
			error.value = null;
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		loading.value = false;
	}
}

/** Save the selected Broadcast Graphic as a new template at revision 1. */
async function save() {
	if (!canSave.value || !props.selectedGraphic)
		return;
	saving.value = true;
	try {
		await repository.save({
			eventId: props.eventId,
			screenId: props.screenId,
			graphicId: props.selectedGraphic.id,
		});
		error.value = null;
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		saving.value = false;
	}
}

/**
 * Place one template on this Screen as an independent copy.
 *
 * The new Broadcast Graphic is reported back so the Edit workspace can select what
 * the author just placed; nothing about the copy points at the template afterwards.
 */
async function place(templateId: string) {
	if (!canAuthor.value)
		return;
	busyTemplateId.value = templateId;
	try {
		const placed = await repository.place({
			eventId: props.eventId,
			screenId: props.screenId,
			templateId,
			// A placement is a read-modify-write of the Screen's whole stack, so it states
			// the version it was built against. Without one the server has nothing to
			// compare and the write would silently discard whatever another author did to
			// the stack in the meantime — the same guard every other write from this editor
			// carries. A Screen missing from the store falls back to 0, which is a real
			// version rather than a skip: it is what a Screen that has never been written
			// carries, so it matches one of those and is refused by every other Screen.
			stateVersion: screenStore.screens.find(screen => screen.id === props.screenId)?.stateVersion ?? 0,
		});
		error.value = null;
		// The Screen was written on the server, and this client's own realtime echo is
		// suppressed, so the authoritative Screen is reloaded here.
		await screenStore.getScreenById(props.eventId, props.screenId);
		emit('placed', placed.graphic.id);
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busyTemplateId.value = null;
	}
}

/**
 * Revise one library entry's own fields.
 *
 * The stored revision travels with the write, so two authors who both had the
 * library open cannot silently overwrite one another: the second is told the template
 * has moved on and the list is re-read.
 */
async function revise(
	template: BroadcastGraphicTemplateSummary,
	patch: { name?: string; description?: string | null },
) {
	if (!canAuthor.value)
		return;
	busyTemplateId.value = template.id;
	try {
		await repository.update(template.id, { ...patch, revision: template.revision });
		error.value = null;
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
		await refresh(true);
	}
	finally {
		busyTemplateId.value = null;
	}
}

async function rename(template: BroadcastGraphicTemplateSummary, name: string) {
	const next = name.trim();
	if (next.length === 0 || next === template.name)
		return;
	await revise(template, { name: next });
}

/** An emptied description clears it rather than storing an empty string. */
async function describe(template: BroadcastGraphicTemplateSummary, description: string) {
	const next = description.trim();
	if (next === (template.description ?? ''))
		return;
	await revise(template, { description: next.length === 0 ? null : next });
}

/**
 * Deleting a template is irreversible and there is no undo, so the first click asks
 * and the second one does it. Copies already placed from the design are unaffected —
 * which is worth saying in the prompt, because it is the thing an author about to
 * delete a design most needs to know.
 */
function askToRemove(templateId: string) {
	if (!canAuthor.value)
		return;
	pendingDeleteId.value = pendingDeleteId.value === templateId ? null : templateId;
}

function cancelRemove() {
	pendingDeleteId.value = null;
}

async function remove(templateId: string) {
	if (!canAuthor.value)
		return;
	busyTemplateId.value = templateId;
	try {
		await repository.remove(templateId);
		error.value = null;
		pendingDeleteId.value = null;
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busyTemplateId.value = null;
	}
}

onMounted(() => {
	void refresh();
});
</script>

<template>
	<ScreenSettingsCard title="Template library" :default-open="true" data-testid="template-library">
		<div class="space-y-3">
			<p class="text-xs text-muted">
				Reusable Broadcast Graphic Templates, shared across every Event in this installation.
				Placing one creates an independent copy.
			</p>

			<UButton
				v-if="canAuthor"
				size="xs"
				variant="soft"
				icon="i-lucide-bookmark-plus"
				:disabled="!canSave"
				data-testid="template-library-save"
				@click="save"
			>
				Save {{ selectedGraphic ? selectedGraphic.name : 'Broadcast Graphic' }} as a template
			</UButton>

			<UAlert
				v-if="error"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Template library action failed"
				:description="error"
				data-testid="template-library-error"
			/>

			<UIEmptyState
				v-if="templates.length === 0 && !loading"
				icon="i-lucide-library"
				title="No Broadcast Graphic Templates"
				description="Save a finished Broadcast Graphic to reuse it on any Screen."
			/>

			<div v-else class="space-y-1.5">
				<div
					v-for="template in templates"
					:key="template.id"
					class="rounded-lg border border-default/70 bg-muted/20 p-2"
					:data-template-id="template.id"
				>
					<div class="flex items-start gap-2">
						<UIcon name="i-lucide-layers" class="mt-1 size-4 shrink-0 text-muted" />
						<div class="min-w-0 flex-1">
							<UInput
								v-if="canAuthor"
								:model-value="template.name"
								size="xs"
								class="w-full"
								aria-label="Template name"
								data-testid="template-name"
								@change="rename(template, ($event.target as HTMLInputElement).value)"
							/>
							<p v-else class="truncate text-sm font-medium">
								{{ template.name }}
							</p>
							<p class="mt-0.5 truncate text-xs text-muted">
								{{ template.itemCount }} items · {{ template.inputCount }} inputs · revision {{ template.revision }}
							</p>
							<UInput
								v-if="canAuthor"
								:model-value="template.description ?? ''"
								size="xs"
								class="mt-1 w-full"
								placeholder="Description"
								aria-label="Template description"
								data-testid="template-description"
								@change="describe(template, ($event.target as HTMLInputElement).value)"
							/>
							<p v-else-if="template.description" class="mt-0.5 truncate text-xs text-muted">
								{{ template.description }}
							</p>

							<!--
								A Graphic Style Set change reaches this template as an offer, never as a
								write. The badge says whether one is waiting; applying it is an explicit
								reviewed act that creates one new template revision.
							-->
							<GraphicsStyleUpdateReview
								:template="template"
								:writable="canAuthor"
								@applied="refresh()"
							/>
						</div>
						<div v-if="canAuthor" class="flex shrink-0 gap-1">
							<UButton
								size="xs"
								variant="subtle"
								icon="i-lucide-plus"
								:disabled="busyTemplateId === template.id"
								:aria-label="`Place ${template.name}`"
								data-testid="template-place"
								@click="place(template.id)"
							>
								Place
							</UButton>
							<UButton
								size="xs"
								color="neutral"
								variant="ghost"
								icon="i-lucide-trash-2"
								:disabled="busyTemplateId === template.id"
								:aria-label="`Delete ${template.name}`"
								data-testid="template-delete"
								@click="askToRemove(template.id)"
							/>
						</div>
					</div>

					<!--
						Deleting a design cannot be undone, so the first click asks. The prompt
						says the thing an author most needs to know before answering: the
						Broadcast Graphics already placed from it are independent copies and
						survive.
					-->
					<div
						v-if="canAuthor && pendingDeleteId === template.id"
						class="mt-2 rounded-md border border-error/40 bg-error/10 p-2"
						data-testid="template-delete-confirm"
					>
						<p class="text-xs">
							Delete “{{ template.name }}” from the library? This cannot be undone.
							Broadcast Graphics already placed from it are not affected.
						</p>
						<div class="mt-2 flex gap-1.5">
							<UButton
								size="xs"
								color="error"
								variant="subtle"
								:disabled="busyTemplateId === template.id"
								data-testid="template-delete-confirmed"
								@click="remove(template.id)"
							>
								Delete
							</UButton>
							<UButton
								size="xs"
								color="neutral"
								variant="ghost"
								data-testid="template-delete-cancelled"
								@click="cancelRemove"
							>
								Cancel
							</UButton>
						</div>
					</div>
				</div>
			</div>
		</div>
	</ScreenSettingsCard>
</template>
