<script setup lang="ts">
import type { FeatureMatchLayoutTemplateSummary } from '~~/shared/types/featureMatchLayoutTemplate';
import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';

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

const templates = ref<FeatureMatchLayoutTemplateSummary[]>([]);
const loading = ref(false);
const busyTemplateId = ref<string | null>(null);
const saving = ref(false);
const error = ref<string | null>(null);
/** The template whose placement is awaiting confirmation, if any. */
const pendingPlaceId = ref<string | null>(null);
/** The template whose deletion is awaiting confirmation, if any. */
const pendingDeleteId = ref<string | null>(null);

/** Fail closed: an unstated permission is never permission. */
const canAuthor = computed(() => props.writable === true);

/**
 * Whether this entry can be renamed, described, or deleted here.
 *
 * Two separate questions: whether this session may author at all, and whether *this
 * layout* is one the library owns. A layout a Template Package installed is the
 * Graphics Asset Library's own record of what it published; it is browsed, placed,
 * and exported like any other, and changed by placing it and saving the placed copy.
 */
function canRevise(template: FeatureMatchLayoutTemplateSummary): boolean {
	return canAuthor.value && template.authored;
}

function failureMessage(caught: unknown): string {
	const data = (caught as { data?: { message?: string } })?.data;
	if (typeof data?.message === 'string' && data.message.length > 0)
		return data.message;
	return caught instanceof Error ? caught.message : 'The Feature Match Layout Template library is unavailable';
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
	if (!canAuthor.value)
		return;
	busyTemplateId.value = templateId;
	try {
		await repository.place({
			eventId: props.eventId,
			screenId: props.screenId,
			templateId,
			// A placement is a read-modify-write of the Screen, so it states the version
			// it was built against. A Screen missing from the store falls back to 0, which
			// is a real version rather than a skip: it is what a Screen that has never been
			// written carries, so it matches one of those and is refused by every other.
			stateVersion: screenStore.screens.find(screen => screen.id === props.screenId)?.stateVersion ?? 0,
		});
		error.value = null;
		pendingPlaceId.value = null;
		// The Screen was written on the server, and this client's own realtime echo is
		// suppressed, so the authoritative Screen is reloaded here.
		await screenStore.getScreenById(props.eventId, props.screenId);
		emit('placed');
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
 * library open cannot silently overwrite one another: the second is told the
 * template has moved on and the list is re-read.
 */
async function revise(
	template: FeatureMatchLayoutTemplateSummary,
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

async function rename(template: FeatureMatchLayoutTemplateSummary, name: string) {
	const next = name.trim();
	if (next.length === 0 || next === template.name)
		return;
	await revise(template, { name: next });
}

/** An emptied description clears it rather than storing an empty string. */
async function describe(template: FeatureMatchLayoutTemplateSummary, description: string) {
	const next = description.trim();
	if (next === (template.description ?? ''))
		return;
	await revise(template, { description: next.length === 0 ? null : next });
}

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

/* ────────────────────────────────────────────────
 * Template Packages
 * ──────────────────────────────────────────────── */

/**
 * Importing a package is deliberately not a one-click action.
 *
 * Preflight can reach three conclusions and each needs a different thing from the
 * author: a rejection is terminal and explains itself, a clean proposal installs
 * straight away, and a proposal carrying warnings pauses exactly once for a
 * confirmation bound to that exact report.
 */
const importing = ref(false);
const pendingImport = ref<GraphicsIngestionOperation | null>(null);

const importFileInput = useTemplateRef<HTMLInputElement>('importFileInput');

/** The issues an author is being asked to accept, or the reasons a package was refused. */
const importIssues = computed(() => pendingImport.value?.templatePackagePreflight?.issues ?? []);
const importRejected = computed(() =>
	pendingImport.value?.templatePackagePreflight?.outcome === 'rejected',
);
const importAwaitingConfirmation = computed(() =>
	pendingImport.value?.stage === 'awaiting-confirmation',
);

function dismissImport() {
	pendingImport.value = null;
}

/** Finish an operation that has nothing left to ask, and show what it produced. */
async function installReceivedPackage(operationId: string) {
	const installed = await repository.installPackage(operationId);
	pendingImport.value = installed.stage === 'completed' ? null : installed;
	await refresh();
}

async function importPackage(file: File) {
	if (!canAuthor.value)
		return;
	importing.value = true;
	pendingImport.value = null;
	try {
		const received = await repository.receivePackage(file);
		error.value = null;
		if (received.stage === 'awaiting-installation') {
			await installReceivedPackage(received.id);
			return;
		}
		// Rejected, or paused for the one confirmation it is entitled to ask for.
		pendingImport.value = received;
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		importing.value = false;
	}
}

async function confirmImport() {
	const operation = pendingImport.value;
	const fingerprint = operation?.templatePackagePreflight?.fingerprint;
	if (!canAuthor.value || !operation || !fingerprint)
		return;
	importing.value = true;
	try {
		await repository.confirmPackage(operation.id, fingerprint);
		await installReceivedPackage(operation.id);
		error.value = null;
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		importing.value = false;
	}
}

function onImportFileChosen(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	// Cleared straight away so choosing the same file twice still fires a change.
	input.value = '';
	if (file)
		void importPackage(file);
}

onMounted(() => {
	void refresh();
});
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

			<!--
				Importing a layout from elsewhere. The file picker is hidden behind an
				ordinary button so the control reads like the library's other actions
				rather than like a form.
			-->
			<div v-if="canAuthor">
				<input
					ref="importFileInput"
					type="file"
					accept=".sklayout"
					class="hidden"
					data-testid="layout-template-import-input"
					@change="onImportFileChosen"
				>
				<UButton
					size="xs"
					variant="soft"
					icon="i-lucide-package-open"
					:loading="importing"
					:disabled="importing"
					data-testid="layout-template-import"
					@click="importFileInput?.click()"
				>
					Import a Template Package
				</UButton>
			</div>

			<!--
				What preflight concluded. A rejection is terminal and lists every reason
				at once; a pause lists what the author is being asked to accept before
				anything is installed.
			-->
			<div
				v-if="pendingImport"
				class="rounded-md border p-2"
				:class="importRejected ? 'border-error/40 bg-error/10' : 'border-warning/40 bg-warning/10'"
				data-testid="layout-template-import-report"
			>
				<p class="text-xs font-medium">
					{{ importRejected
						? 'This Template Package cannot be installed'
						: 'Review before installing this Template Package' }}
				</p>
				<ul class="mt-1 space-y-1">
					<li v-for="(issue, index) in importIssues" :key="`${issue.code}-${index}`" class="text-xs text-muted">
						{{ issue.message }}<span v-if="issue.remediation"> — {{ issue.remediation }}</span>
					</li>
				</ul>
				<div class="mt-2 flex gap-1.5">
					<UButton
						v-if="importAwaitingConfirmation"
						size="xs"
						variant="subtle"
						:loading="importing"
						:disabled="importing"
						data-testid="layout-template-import-confirm"
						@click="confirmImport"
					>
						Install
					</UButton>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						data-testid="layout-template-import-dismiss"
						@click="dismissImport"
					>
						{{ importAwaitingConfirmation ? 'Cancel' : 'Dismiss' }}
					</UButton>
				</div>
			</div>

			<UAlert
				v-if="error"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Layout template action failed"
				:description="error"
				data-testid="layout-template-error"
			/>

			<UIEmptyState
				v-if="templates.length === 0 && !loading"
				icon="i-lucide-library"
				title="No Feature Match Layout Templates"
				description="Save a finished layout to reuse it on any Feature Match Overlay Screen."
			/>

			<div v-else class="space-y-1.5">
				<div
					v-for="template in templates"
					:key="template.id"
					class="rounded-lg border border-default/70 bg-muted/20 p-2"
					:data-template-id="template.id"
				>
					<div class="flex items-start gap-2">
						<UIcon name="i-lucide-layout-template" class="mt-1 size-4 shrink-0 text-muted" />
						<div class="min-w-0 flex-1">
							<!--
								An imported layout is read here rather than edited. It is the
								Graphics Asset Library's own record of what a Template Package
								installed, and this library never writes one — so offering a
								field that cannot be saved would be a control that lies.
							-->
							<UInput
								v-if="canRevise(template)"
								:model-value="template.name"
								size="xs"
								class="w-full"
								aria-label="Template name"
								data-testid="layout-template-name"
								@change="rename(template, ($event.target as HTMLInputElement).value)"
							/>
							<p v-else class="truncate text-sm font-medium">
								{{ template.name }}
							</p>
							<p class="mt-0.5 truncate text-xs text-muted">
								{{ template.itemCount }} items · {{ template.sourceCount }} sources · revision {{ template.revision }}
								<span v-if="!template.authored" data-testid="layout-template-imported"> · imported</span>
							</p>
							<UInput
								v-if="canRevise(template)"
								:model-value="template.description ?? ''"
								size="xs"
								class="mt-1 w-full"
								placeholder="Description"
								aria-label="Template description"
								data-testid="layout-template-description"
								@change="describe(template, ($event.target as HTMLInputElement).value)"
							/>
							<p v-else-if="template.description" class="mt-0.5 truncate text-xs text-muted">
								{{ template.description }}
							</p>
						</div>
						<div v-if="canAuthor" class="flex shrink-0 gap-1">
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
						</div>
					</div>

					<!--
						Placing is destructive to the Screen's current layout and cannot be
						undone, so the first click asks and says exactly what survives.
					-->
					<div
						v-if="canAuthor && pendingPlaceId === template.id"
						class="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2"
						data-testid="layout-template-place-confirm"
					>
						<p class="text-xs">
							Replace this Screen's Feature Match Layout with “{{ template.name }}”?
							The Frame, Source Items, and every Graphic Item are replaced. The
							Screen's Feature Match Slot and canvas size are kept.
						</p>
						<div class="mt-2 flex gap-1.5">
							<UButton
								size="xs"
								color="warning"
								variant="subtle"
								:disabled="busyTemplateId === template.id"
								data-testid="layout-template-place-confirmed"
								@click="place(template.id)"
							>
								Replace layout
							</UButton>
							<UButton
								size="xs"
								color="neutral"
								variant="ghost"
								data-testid="layout-template-place-cancelled"
								@click="cancelPlace"
							>
								Cancel
							</UButton>
						</div>
					</div>

					<!--
						Deleting a layout cannot be undone, so the first click asks. The prompt
						says the thing an author most needs to know before answering: layouts
						already placed from it are independent copies and survive.
					-->
					<div
						v-if="canAuthor && pendingDeleteId === template.id"
						class="mt-2 rounded-md border border-error/40 bg-error/10 p-2"
						data-testid="layout-template-delete-confirm"
					>
						<p class="text-xs">
							Delete “{{ template.name }}” from the library? This cannot be undone.
							Layouts already placed from it are not affected.
						</p>
						<div class="mt-2 flex gap-1.5">
							<UButton
								size="xs"
								color="error"
								variant="subtle"
								:disabled="busyTemplateId === template.id"
								data-testid="layout-template-delete-confirmed"
								@click="remove(template.id)"
							>
								Delete
							</UButton>
							<UButton
								size="xs"
								color="neutral"
								variant="ghost"
								data-testid="layout-template-delete-cancelled"
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
