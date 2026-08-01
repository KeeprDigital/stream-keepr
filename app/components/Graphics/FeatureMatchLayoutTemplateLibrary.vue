<script setup lang="ts">
import type { FeatureMatchLayoutTemplateSummary } from '~~/shared/types/featureMatchLayoutTemplate';

/**
 * The Feature Match Layout Template library, as an author browses and manages it.
 *
 * The library is installation-scoped, so this is the same library from every Event's
 * Feature Match Overlay editor — which is what makes a layout saved during one show
 * placeable in the next without anything being copied between Events.
 *
 * Placing replaces the Screen's whole Feature Match Layout, and the confirmation
 * says so before it happens. A Feature Match Overlay renders exactly one layout, so
 * there is no "add" here and nothing to merge: the Frame, the Source Items, and the
 * composition arrive together or not at all. What the Screen keeps is everything
 * that was never part of the layout — its Feature Match Slot and its canvas.
 *
 * Placing and saving are server operations rather than local edits. The server reads
 * the template and writes it through the Screen's own configuration path, so the
 * placed layout is validated, indexed, and published exactly as a hand-authored one
 * — and the Screen is then reloaded authoritatively rather than patched from a
 * guess.
 *
 * Browsing, revising, deleting, and receiving a Template Package are the same in this
 * library and in the Broadcast Graphic Template library, because a Template Package
 * means the same thing in both, so they share `useGraphicsTemplateLibrary`.
 */
const props = defineProps<{
	eventId: number;
	screenId: number;
	/**
	 * Whether this session may author. A session observing a Screen another
	 * session's Graphics Authoring Lease covers still browses the library, because
	 * looking through the available designs corrupts nothing.
	 */
	writable?: boolean;
}>();

const emit = defineEmits<{ placed: [] }>();

const repository = useFeatureMatchLayoutTemplateRepository();
const screenStore = useScreenStore();
const placementVersion = useScreenPlacementVersion(() => props.screenId);

/** Fail closed: an unstated permission is never permission. */
const canAuthor = computed(() => props.writable === true);

const library = useGraphicsTemplateLibrary<FeatureMatchLayoutTemplateSummary>({
	repository,
	canAuthor,
	unavailable: 'The Feature Match Layout Template library is unavailable',
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
	packageImport,
} = library;

const saving = ref(false);
/** The template whose placement is awaiting confirmation, if any. */
const pendingPlaceId = ref<string | null>(null);

/** Save this Screen's Feature Match Layout as a new template at revision 1. */
async function save() {
	if (!canAuthor.value || saving.value)
		return;
	saving.value = true;
	try {
		await repository.save({ eventId: props.eventId, screenId: props.screenId });
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
 * Placing overwrites work an author may not have meant to lose, and there is no
 * undo, so the first click asks and the second one does it.
 */
function askToPlace(templateId: string) {
	if (!canAuthor.value)
		return;
	pendingPlaceId.value = pendingPlaceId.value === templateId ? null : templateId;
}

function cancelPlace() {
	pendingPlaceId.value = null;
}

async function place(templateId: string) {
	await attempt(templateId, async () => {
		await repository.place({
			eventId: props.eventId,
			screenId: props.screenId,
			templateId,
			stateVersion: placementVersion.value,
		});
		pendingPlaceId.value = null;
		// The Screen was written on the server, and this client's own realtime echo is
		// suppressed, so the authoritative Screen is reloaded here.
		await screenStore.getScreenById(props.eventId, props.screenId);
		emit('placed');
	});
}
</script>

<template>
	<ScreenSettingsCard title="Layout template library" :default-open="false" data-testid="layout-template-library">
		<div class="space-y-3">
			<p class="text-xs text-muted">
				Reusable Feature Match Layout Templates, shared across every Event in this installation.
				Placing one replaces this Screen's whole layout with an independent copy.
			</p>

			<UButton
				v-if="canAuthor"
				size="xs"
				variant="soft"
				icon="i-lucide-bookmark-plus"
				:disabled="saving"
				data-testid="layout-template-save"
				@click="save"
			>
				Save this layout as a template
			</UButton>

			<GraphicsTemplateLibraryImport
				kind="sklayout"
				test-id="layout-template-import"
				:writable="canAuthor"
				:state="packageImport"
			/>

			<GraphicsLibraryError
				title="Layout template action failed"
				:message="error"
				test-id="layout-template-error"
			/>

			<UIEmptyState
				v-if="templates.length === 0 && !loading"
				icon="i-lucide-library"
				title="No Feature Match Layout Templates"
				description="Save a finished layout to reuse it on any Feature Match Overlay Screen."
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
					icon="i-lucide-layout-template"
					test-id="layout-template"
					:revisable="canRevise(template)"
					:writable="canAuthor"
					@rename="revise(template, { name: $event })"
					@describe="revise(template, { description: $event })"
				>
					<template #meta>
						<!--
							Source Items are counted apart from Graphic Items, because they are
							host-owned and budgeted apart.
						-->
						{{ template.itemCount }} items · {{ template.sourceCount }} sources
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
							data-testid="layout-template-export"
						/>
						<UButton
							size="xs"
							variant="subtle"
							icon="i-lucide-replace"
							:disabled="busyTemplateId === template.id"
							:aria-label="`Place ${template.name}`"
							data-testid="layout-template-place"
							@click="askToPlace(template.id)"
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
							data-testid="layout-template-delete"
							@click="askToRemove(template.id)"
						/>
					</template>

					<!--
						Placing is destructive to the Screen's current layout and cannot be
						undone, so the first click asks and says exactly what survives.
					-->
					<GraphicsTemplateLibraryConfirmation
						v-if="canAuthor && pendingPlaceId === template.id"
						tone="warning"
						test-id="layout-template-place"
						confirm-label="Replace layout"
						:busy="busyTemplateId === template.id"
						@confirm="place(template.id)"
						@cancel="cancelPlace"
					>
						Replace this Screen's Feature Match Layout with “{{ template.name }}”?
						The Frame, Source Items, and every Graphic Item are replaced. The
						Screen's Feature Match Slot and canvas size are kept.
					</GraphicsTemplateLibraryConfirmation>

					<!--
						Deleting a layout cannot be undone, so the first click asks. The prompt
						says the thing an author most needs to know before answering: layouts
						already placed from it are independent copies and survive.
					-->
					<GraphicsTemplateLibraryConfirmation
						v-if="canAuthor && pendingDeleteId === template.id"
						tone="error"
						test-id="layout-template-delete"
						confirm-label="Delete"
						:busy="busyTemplateId === template.id"
						@confirm="remove(template.id)"
						@cancel="cancelRemove"
					>
						Delete “{{ template.name }}” from the library? This cannot be undone.
						Layouts already placed from it are not affected.
					</GraphicsTemplateLibraryConfirmation>
				</GraphicsTemplateLibraryEntry>
			</div>
		</div>
	</ScreenSettingsCard>
</template>
