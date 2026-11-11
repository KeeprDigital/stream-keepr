<script setup lang="ts">
import type { FeatureMatchLayoutTemplateSummary } from '~~/shared/types/featureMatchLayoutTemplate';
import ScreenSettingsSection from '~/components/Screen/SettingsSection.vue';

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
 * guess. Both read the Screen as stored, so the editor's unsaved edits are landed
 * first (`flushEdits`), and the editor holds authoring while a placement is in
 * flight (the `placing` model): an edit sent after it carries the whole layout
 * from before it, and would write the placed one away.
 *
 * The built-in layouts are listed with the rest. One is placed like any other, and
 * offers nothing else: it is no record of this installation's to revise, delete or
 * export. A built-in was drawn for one canvas shape, so placing it on an Event
 * canvas of another shape says so before it happens.
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
	/** Render without its own collapsible card, inside a host's panel. */
	bare?: boolean;
	/**
	 * Lands the editor's unsaved edits, answering whether none is left unsaved.
	 * A host with no unsaved edits passes nothing.
	 */
	flushEdits?: () => Promise<boolean>;
	/** The Event canvas's width over its height, which a placed layout has to fit. */
	canvasAspectRatio?: number;
}>();

/**
 * `placing` fires just before a placement writes the Screen, once the editor's
 * edits have landed, so a host can remember the layout it is about to lose;
 * `placed` once the placed one is loaded.
 */
const emit = defineEmits<{ placing: []; placed: [] }>();

/** Whether a placement is in flight, from its first step until the placed Screen is held. */
const placing = defineModel<boolean>('placing', { default: false });

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

const saving = ref(false);
/** The template whose placement is awaiting confirmation, if any. */
const pendingPlaceId = ref<string | null>(null);

/** Land the editor's unsaved edits, or refuse to go on reading a Screen that lacks them. */
async function landEdits() {
	if (props.flushEdits && !await props.flushEdits())
		throw new Error('An edit to this Screen could not be saved. Retry the save, then try again.');
}

/** Save this Screen's Feature Match Layout as a new template at revision 1. */
async function save() {
	if (!canAuthor.value || saving.value)
		return;
	saving.value = true;
	try {
		await landEdits();
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
	pendingPlaceId.value = pendingPlaceId.value === templateId
		? null
		: templateId;
}

/**
 * Whether a template was drawn for a canvas of another shape than this Event's.
 * Only a template that states its aspect ratio can be asked, which today is a
 * built-in; a saved or installed layout carries no canvas size.
 */
function aspectMismatch(template: FeatureMatchLayoutTemplateSummary): boolean {
	if (template.aspectRatio === undefined || props.canvasAspectRatio === undefined)
		return false;
	return Math.abs(props.canvasAspectRatio - template.aspectRatio) > 0.05;
}

function cancelPlace() {
	pendingPlaceId.value = null;
}

async function place(templateId: string) {
	await attempt(templateId, async () => {
		placing.value = true;
		try {
			await landEdits();
			emit('placing');
			await repository.place({
				eventId: props.eventId,
				screenId: props.screenId,
				templateId,
				// Read once the edits have landed: each of them moved the Screen on.
				stateVersion: placementVersion.value,
			});
			pendingPlaceId.value = null;
			// The Screen was written on the server, and this client's own realtime echo is
			// suppressed, so the authoritative Screen is reloaded here.
			await screenStore.getScreenById(props.eventId, props.screenId);
			emit('placed');
		}
		finally {
			placing.value = false;
		}
	});
}
</script>

<template>
	<component
		:is="bare ? 'div' : ScreenSettingsSection"
		v-bind="bare ? {} : { title: 'Layout template library', defaultOpen: false }"
		data-testid="layout-template-library"
	>
		<GraphicsTemplateLibrarySurface
			kind="sklayout"
			test-id="layout-template"
			:writable="canAuthor"
			:package-import="packageImport"
			:error="error"
			:signed-out="signedOut"
			error-title="Layout template action failed"
			:empty="templates.length === 0 && !loading"
			empty-title="No Feature Match Layout Templates"
			empty-description="Save a finished layout to reuse it on any Feature Match Overlay Screen."
		>
			<template #intro>
				Reusable Feature Match Layout Templates, shared across every Event in this installation.
				Placing one replaces this Screen's whole layout with an independent copy.
			</template>

			<template v-if="canAuthor" #save>
				<UButton
					size="xs"
					variant="soft"
					icon="i-lucide-bookmark-plus"
					:disabled="saving"
					data-testid="layout-template-save"
					@click="save"
				>
					Save this layout as a template
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
					:built-in="template.builtIn"
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
							v-if="!template.builtIn"
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
							v-if="canAuthor && !template.builtIn"
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
						<span
							v-if="aspectMismatch(template)"
							class="mt-1 block"
							data-testid="layout-template-place-aspect-warning"
						>
							It was drawn for a canvas of a different shape than this Event's,
							so its geometry may need adjusting once placed.
						</span>
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
						Delete “{{ template.name }}” from the library?
						<template v-if="template.authored">
							This cannot be undone.
						</template>
						<template v-else>
							Importing its Template Package again adds it back as a new entry.
						</template>
						Layouts already placed from it are not affected.
					</GraphicsTemplateLibraryConfirmation>
				</GraphicsTemplateLibraryEntry>
			</template>
		</GraphicsTemplateLibrarySurface>
	</component>
</template>
