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
 *
 * Browsing, revising, deleting, and receiving a Template Package are the same in this
 * library and in the Feature Match Layout Template library, because a Template Package
 * means the same thing in both, so they share `useGraphicsTemplateLibrary`.
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

/** Fail closed: an unstated permission is never permission. */
const canAuthor = computed(() => props.writable === true);

const library = useGraphicsTemplateLibrary<BroadcastGraphicTemplateSummary>({
	repository,
	canAuthor,
	unavailable: 'The Broadcast Graphic Template library is unavailable',
});
const {
	entries: templates,
	loading,
	error,
	failureMessage,
	refresh,
	busyTemplateId,
	pendingDeleteId,
	canRevise,
	attempt,
	revise,
	askToRemove,
	cancelRemove,
	remove,
	importing,
	pendingImport,
	importIssues,
	importRejected,
	importAwaitingConfirmation,
	importPackage,
	confirmImport,
	dismissImport,
} = library;

const saving = ref(false);
const canSave = computed(() => canAuthor.value && !!props.selectedGraphic && !saving.value);

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
	await attempt(templateId, async () => {
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
		// The Screen was written on the server, and this client's own realtime echo is
		// suppressed, so the authoritative Screen is reloaded here.
		await screenStore.getScreenById(props.eventId, props.screenId);
		emit('placed', placed.graphic.id);
	});
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

			<!--
				A Template Package installs as an Installed Graphics Template: an independent
				local copy with this installation's own identity and revision, keeping the
				packaged Template's identity as provenance only.
			-->
			<GraphicsPackageImport
				package-noun="Template Package"
				accept=".skgraphic"
				test-id="template-library-import"
				:writable="canAuthor"
				:busy="importing"
				:reported="!!pendingImport"
				:issues="importIssues"
				:rejected="importRejected"
				:awaiting-confirmation="importAwaitingConfirmation"
				@file="importPackage"
				@confirm="confirmImport"
				@dismiss="dismissImport"
			/>

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
				<GraphicsTemplateLibraryEntry
					v-for="template in templates"
					:key="template.id"
					:template-id="template.id"
					:name="template.name"
					:description="template.description"
					:revision="template.revision"
					:authored="template.authored"
					icon="i-lucide-layers"
					test-id="template"
					:revisable="canRevise(template)"
					:writable="canAuthor"
					@rename="revise(template, { name: $event })"
					@describe="revise(template, { description: $event })"
				>
					<template #meta>
						{{ template.itemCount }} items · {{ template.inputCount }} inputs
					</template>

					<template #detail>
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
					</template>

					<template #actions>
						<!--
							A plain download, because a Template Package is a file an author
							keeps rather than a response this component has any use for.
						-->
						<UButton
							size="xs"
							color="neutral"
							variant="ghost"
							icon="i-lucide-package"
							:to="repository.packageUrl(template.id)"
							external
							download
							:aria-label="`Export ${template.name}`"
							data-testid="template-export"
						/>
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
							v-if="canRevise(template)"
							size="xs"
							color="neutral"
							variant="ghost"
							icon="i-lucide-trash-2"
							:disabled="busyTemplateId === template.id"
							:aria-label="`Delete ${template.name}`"
							data-testid="template-delete"
							@click="askToRemove(template.id)"
						/>
					</template>

					<!--
						Deleting a design cannot be undone, so the first click asks. The prompt
						says the thing an author most needs to know before answering: the
						Broadcast Graphics already placed from it are independent copies and
						survive.
					-->
					<GraphicsTemplateLibraryConfirmation
						v-if="canAuthor && pendingDeleteId === template.id"
						tone="error"
						test-id="template-delete"
						confirm-label="Delete"
						:busy="busyTemplateId === template.id"
						@confirm="remove(template.id)"
						@cancel="cancelRemove"
					>
						Delete “{{ template.name }}” from the library? This cannot be undone.
						Broadcast Graphics already placed from it are not affected.
					</GraphicsTemplateLibraryConfirmation>
				</GraphicsTemplateLibraryEntry>
			</div>
		</div>
	</ScreenSettingsCard>
</template>
