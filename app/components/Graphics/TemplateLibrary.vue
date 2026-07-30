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

/** Fail closed: an unstated permission is never permission. */
const canAuthor = computed(() => props.writable === true);
const canSave = computed(() => canAuthor.value && !!props.selectedGraphic && !saving.value);

function failureMessage(caught: unknown): string {
	const data = (caught as { data?: { message?: string } })?.data;
	if (typeof data?.message === 'string' && data.message.length > 0)
		return data.message;
	return caught instanceof Error ? caught.message : 'The Broadcast Graphic Template library is unavailable';
}

async function refresh() {
	loading.value = true;
	try {
		templates.value = await repository.list();
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

async function rename(template: BroadcastGraphicTemplateSummary, name: string) {
	const next = name.trim();
	if (!canAuthor.value || next.length === 0 || next === template.name)
		return;
	busyTemplateId.value = template.id;
	try {
		await repository.update(template.id, { name: next });
		error.value = null;
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busyTemplateId.value = null;
	}
}

async function remove(templateId: string) {
	if (!canAuthor.value)
		return;
	busyTemplateId.value = templateId;
	try {
		await repository.remove(templateId);
		error.value = null;
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
							<p v-if="template.description" class="mt-0.5 truncate text-xs text-muted">
								{{ template.description }}
							</p>
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
								@click="remove(template.id)"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	</ScreenSettingsCard>
</template>
