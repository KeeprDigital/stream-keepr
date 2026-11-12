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
 * patched from a guess. Both read the Screen as stored, so the workspace's unsaved
 * edits are landed first (`flushEdits`), and the workspace holds authoring while a
 * placement is in flight (`placing`): an edit sent after it carries the whole stack
 * from before it, and would write the placed Broadcast Graphic away.
 *
 * Browsing, revising, deleting, and receiving a Template Package are the same in this
 * library and in the Feature Match Layout Template library, because a Template Package
 * means the same thing in both, so they share `useGraphicsTemplateLibrary` and draw
 * the one `GraphicsTemplateLibrarySurface`.
 *
 * Beside the stack it is a section that starts closed and says how many designs the
 * library holds. A closed section keeps the library mounted, so a placement under way
 * still finishes and releases `placing`.
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
	/**
	 * Lands the workspace's unsaved edits, answering whether none is left unsaved.
	 * A host with no unsaved edits passes nothing.
	 */
	flushEdits?: () => Promise<boolean>;
}>();

const emit = defineEmits<{ placed: [graphicId: string] }>();

/** Whether a placement is in flight, from its first step until the placed Screen is held. */
const placing = defineModel<boolean>('placing', { default: false });

const repository = useBroadcastGraphicTemplateRepository();
const screenStore = useScreenStore();
const placementVersion = useScreenPlacementVersion(() => props.screenId);

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
	signedOut,
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
	packageImport,
} = library;

/**
 * The closed section in one line: how many designs the library holds. Nothing
 * until the library has been read, so it never says "None" of one it has not seen.
 */
const summary = computed(() => {
	const count = templates.value.length;
	if (count === 0)
		return loading.value ? undefined : 'None';
	return `${count} ${count === 1
		? 'template'
		: 'templates'}`;
});

const saving = ref(false);

/** Land the workspace's unsaved edits, or refuse to go on reading a Screen that lacks them. */
async function landEdits() {
	if (props.flushEdits && !await props.flushEdits())
		throw new Error('An edit to this Screen could not be saved. Retry the save, then try again.');
}
const canSave = computed(() => canAuthor.value && !!props.selectedGraphic && !saving.value);

/** Save the selected Broadcast Graphic as a new template at revision 1. */
async function save() {
	if (!canSave.value || !props.selectedGraphic)
		return;
	saving.value = true;
	try {
		await landEdits();
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
		placing.value = true;
		try {
			await landEdits();
			const placed = await repository.place({
				eventId: props.eventId,
				screenId: props.screenId,
				templateId,
				// Read once the edits have landed: each of them moved the Screen on.
				stateVersion: placementVersion.value,
			});
			// The Screen was written on the server, and this client's own realtime echo is
			// suppressed, so the authoritative Screen is reloaded here.
			await screenStore.getScreenById(props.eventId, props.screenId);
			emit('placed', placed.graphic.id);
		}
		finally {
			placing.value = false;
		}
	});
}
</script>

<template>
	<ScreenSettingsSection
		id="broadcast-graphics-templates"
		density="row"
		title="Templates"
		:summary="summary"
		data-testid="template-library"
	>
		<GraphicsTemplateLibrarySurface
			kind="skgraphic"
			test-id="template-library"
			:writable="canAuthor"
			:package-import="packageImport"
			:error="error"
			:signed-out="signedOut"
			error-title="Template library action failed"
			:empty="templates.length === 0 && !loading"
			empty-title="No Broadcast Graphic Templates"
			empty-description="Save a finished Broadcast Graphic to reuse it on any Screen."
		>
			<template #intro>
				Reusable Broadcast Graphic Templates, shared across every Event in this installation.
				Placing one creates an independent copy.
			</template>

			<template v-if="canAuthor" #save>
				<UButton
					size="xs"
					variant="soft"
					icon="i-lucide-bookmark-plus"
					:disabled="!canSave"
					data-testid="template-library-save"
					@click="save"
				>
					Save {{ selectedGraphic ? selectedGraphic.name : 'Broadcast Graphic' }} as a template
				</UButton>
			</template>

			<template #default>
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
							v-if="canAuthor"
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
						Delete “{{ template.name }}” from the library?
						<template v-if="template.authored">
							This cannot be undone.
						</template>
						<template v-else>
							Importing its Template Package again adds it back as a new entry.
						</template>
						Broadcast Graphics already placed from it are not affected.
					</GraphicsTemplateLibraryConfirmation>
				</GraphicsTemplateLibraryEntry>
			</template>
		</GraphicsTemplateLibrarySurface>
	</ScreenSettingsSection>
</template>
