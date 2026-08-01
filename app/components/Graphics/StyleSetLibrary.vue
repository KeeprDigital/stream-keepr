<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type {
	AffectedGraphicsTemplate,
	GraphicStyleEntryKind,
	GraphicStyleSetEntry,
	GraphicStyleSetPublishIssue,
	GraphicStyleSetResponse,
	GraphicStyleSetSummary,
} from '~~/shared/types/graphicStyleSet';
import type {
	GraphicStyleSetPackageErrorCode,
	GraphicStyleSetPackagePreflightReport,
	GraphicStyleSetPackageResolution,
} from '~~/shared/types/graphicStyleSetPackage';
import {
	createGraphicStyleEntry,
	detachGraphicStyleRefs,
} from '~~/shared/modules/graphic-style-sets';
import { GRAPHIC_STYLE_ENTRY_KIND_VALUES } from '~~/shared/types/graphicStyleSet';
import { randomUuid } from '~~/shared/utils/uuid';

/**
 * The Graphic Style Set library, as an author browses, edits, and publishes it.
 *
 * Installation-scoped, so this is the same library from every Event's Edit workspace
 * — which is what keeps one visual language across designs that travel independently.
 *
 * ## Two things this surface exists to keep distinct
 *
 * **Draft and published.** Every edit here goes into a working draft that no linked
 * template can see. One explicit publish validates the whole thing and makes it what
 * every linked template resolves against. The button says how many templates that
 * reaches, and reaching them is all it does — it writes none of them.
 *
 * **Linking and adopting.** Linking a Broadcast Graphic to a Style Set is one click
 * and adopts nothing: every property stays exactly as local as it was. Entries are
 * referenced afterwards, one property control at a time, in the inspector. There is
 * deliberately no "apply this style to everything" here, because a bulk mapping is
 * the workflow the glossary rules out.
 *
 * ## Why this does not import the way the Template libraries do
 *
 * A Graphic Style Set Package is deliberately **not** a Template Package, so this
 * library builds on the neutral `useReusableLibraryReading` and keeps its own import path
 * rather than sharing `useGraphicsTemplateLibrary` with the two Template libraries.
 * Installing a Template Package yields an unlinked copy; the first import of a Graphic
 * Style Set Package *preserves* the packaged identity and revision, so a later related
 * revision can be recognised and offered as an ordinary update instead of accumulating
 * duplicates. An independent copy with a new identity exists here too, but as the
 * fallback an author explicitly asks for when a package conflicts with what is already
 * installed — never as what an import quietly does.
 */
const props = defineProps<{
	/** The Broadcast Graphic an author can link, when the workspace has one selected. */
	selectedGraphic?: BroadcastGraphicConfig | null;
	writable?: boolean;
}>();

const emit = defineEmits<{
	/** A change to the selected Broadcast Graphic's Style Set link. */
	'update:graphic': [graphic: BroadcastGraphicConfig];
	/** The published Style Set changed, so anything holding it should reload. */
	'published': [];
}>();

const repository = useGraphicStyleSetRepository();

const issues = ref<GraphicStyleSetPublishIssue[]>([]);

const {
	entries: styleSets,
	loading,
	error,
	failureMessage,
	refresh,
} = useReusableLibraryReading<GraphicStyleSetSummary>({
	read: () => repository.list(),
	unavailable: 'The Graphic Style Set library is unavailable',
	// A draft this library cannot publish is refused with every reason at once, and they
	// travel beside the message rather than in it.
	inspectFailure: (caught) => {
		const data = (caught as { data?: { data?: { issues?: GraphicStyleSetPublishIssue[] } } })?.data;
		if (data?.data?.issues)
			issues.value = data.data.issues;
	},
});

const open = ref<GraphicStyleSetResponse | null>(null);
const busy = ref(false);
const affected = ref<AffectedGraphicsTemplate[] | null>(null);
const newName = ref('');
const newEntryKind = ref<GraphicStyleEntryKind>('palette');
const pendingDeleteEntryId = ref<string | null>(null);
const replacementEntryId = ref<string | undefined>();

const canAuthor = computed(() => props.writable === true);
const linkedId = computed(() => props.selectedGraphic?.styleSet?.styleSetId ?? null);

const KIND_LABELS: Record<GraphicStyleEntryKind, string> = {
	'palette': 'Palette colour',
	'typography': 'Typography',
	'fill': 'Graphic Fill',
	'surface-style': 'Graphic Surface Style',
	'media-treatment': 'Media treatment',
	'shape-geometry': 'Shape Geometry',
	'animation-recipe': 'Graphic Animation Recipe',
};

const KIND_OPTIONS = GRAPHIC_STYLE_ENTRY_KIND_VALUES.map(kind => ({ label: KIND_LABELS[kind], value: kind }));

/** The entries of the same kind as the one awaiting deletion, which a replacement must be. */
const replacementOptions = computed(() => {
	const subject = open.value?.draft.find(entry => entry.id === pendingDeleteEntryId.value);
	if (!subject)
		return [];
	return open.value!.draft
		.filter(entry => entry.kind === subject.kind && entry.id !== subject.id)
		.map(entry => ({ label: entry.name, value: entry.id }));
});

async function reopenStyleSet(styleSetId: string, keepError = true) {
	busy.value = true;
	try {
		open.value = await repository.get(styleSetId);
		if (!keepError) {
			issues.value = [];
			affected.value = null;
			error.value = null;
		}
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busy.value = false;
	}
}

async function openStyleSet(styleSetId: string) {
	await reopenStyleSet(styleSetId, false);
}

async function create() {
	const name = newName.value.trim();
	if (!canAuthor.value || name.length === 0)
		return;
	busy.value = true;
	try {
		const created = await repository.create({ name });
		newName.value = '';
		open.value = created;
		error.value = null;
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busy.value = false;
	}
}

/**
 * Write the whole draft back.
 *
 * The draft is one document and its edits are unordered, so every change — a rename,
 * a value, an added entry — is the same write with the draft revision the author was
 * looking at. A second session that edited in the meantime refuses this one rather
 * than losing its own work.
 */
async function saveDraft(draft: GraphicStyleSetEntry[]) {
	const current = open.value;
	if (!canAuthor.value || !current)
		return;
	busy.value = true;
	try {
		open.value = await repository.update(current.id, { draft, draftRevision: current.draftRevision });
		error.value = null;
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
		// Re-read so the author is looking at the draft that actually exists, without
		// erasing the message explaining why their write was refused.
		await reopenStyleSet(current.id);
	}
	finally {
		busy.value = false;
	}
}

function addEntry() {
	const current = open.value;
	if (!current)
		return;
	const palette = current.draft.find(entry => entry.kind === 'palette');
	const entry = createGraphicStyleEntry({
		id: randomUuid(),
		kind: newEntryKind.value,
		name: `${KIND_LABELS[newEntryKind.value]} ${current.draft.filter(existing => existing.kind === newEntryKind.value).length + 1}`,
		paletteEntryId: palette?.id,
	});
	if (!entry) {
		// A preset that needs a colour cannot be created before there is one to point
		// at: a reference to nothing is not a value, and the next publish would refuse it.
		error.value = 'Add a palette colour first — typography and Graphic Fill presets reference one rather than storing a colour.';
		return;
	}
	void saveDraft([...current.draft, entry]);
}

function renameEntry(entryId: string, name: string) {
	const current = open.value;
	const next = name.trim();
	if (!current || next.length === 0)
		return;
	// Renaming preserves identity, so nothing that references this entry moves and no
	// linked template sees an available update.
	void saveDraft(current.draft.map(entry => entry.id === entryId ? { ...entry, name: next } : entry));
}

function updateEntryValue(entryId: string, value: GraphicStyleSetEntry['value']) {
	const current = open.value;
	if (!current)
		return;
	void saveDraft(current.draft.map(entry =>
		entry.id === entryId ? { ...entry, value } as GraphicStyleSetEntry : entry,
	));
}

async function deleteEntry(mode: 'replace' | 'detach') {
	const current = open.value;
	const entryId = pendingDeleteEntryId.value;
	if (!canAuthor.value || !current || !entryId)
		return;
	busy.value = true;
	try {
		open.value = await repository.deleteEntry(current.id, entryId, {
			mode,
			...(mode === 'replace' ? { replacementEntryId: replacementEntryId.value ?? '' } : {}),
			draftRevision: current.draftRevision,
		});
		pendingDeleteEntryId.value = null;
		replacementEntryId.value = undefined;
		error.value = null;
		emit('published');
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busy.value = false;
	}
}

async function publish() {
	const current = open.value;
	if (!canAuthor.value || !current)
		return;
	busy.value = true;
	issues.value = [];
	try {
		const result = await repository.publish(current.id, current.draftRevision);
		open.value = result.styleSet;
		affected.value = result.affectedTemplates;
		error.value = null;
		emit('published');
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busy.value = false;
	}
}

async function removeStyleSet() {
	const current = open.value;
	if (!canAuthor.value || !current)
		return;
	busy.value = true;
	try {
		await repository.remove(current.id, current.draftRevision);
		open.value = null;
		error.value = null;
		emit('published');
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busy.value = false;
	}
}

/**
 * Link the selected Broadcast Graphic to one Style Set.
 *
 * Adopting nothing is the point: the link records where inherited properties will
 * come from, and every property stays local until an author picks an entry for it in
 * the inspector.
 *
 * Switching from another Style Set detaches first. A composition links to at most
 * one, so references left over from the previous one would name entries the new
 * Style Set has never heard of — refused the moment the design was saved as a
 * template, and stored unchecked on a Screen until then. Detaching keeps every value
 * they produced, so switching changes what the design *can* inherit and nothing about
 * what it renders.
 */
function link(styleSet: GraphicStyleSetSummary) {
	const graphic = props.selectedGraphic;
	if (!canAuthor.value || !graphic || styleSet.revision === 0)
		return;
	const local = graphic.styleSet && graphic.styleSet.styleSetId !== styleSet.id
		? detachGraphicStyleRefs(graphic, null)
		: graphic;
	emit('update:graphic', {
		...local,
		styleSet: { styleSetId: styleSet.id, revision: styleSet.revision },
	});
}

/* ────────────────────────────────────────────────
 * Graphic Style Set Packages
 * ──────────────────────────────────────────────── */

const importing = ref(false);
/**
 * The received package and what preflight concluded about it.
 *
 * The file is held beside the report because installing sends the bytes again: nothing
 * is staged, so the confirmation is proved against the exact archive the report was
 * derived from rather than against a stored copy of it.
 */
const pendingImport = ref<{
	file: File;
	resolution: GraphicStyleSetPackageResolution;
	report: GraphicStyleSetPackagePreflightReport;
} | null>(null);

/**
 * What an install that asked nothing still had to say.
 *
 * A report is `ready` when confirming it would change nothing — an exact identity,
 * revision, and content match is told rather than asked. That report can still carry
 * findings, and the one that matters is a Style Set installed here under a different
 * name: telling the author their two libraries disagree is the entire reason that
 * import was worth performing, and it would otherwise be the one thing they never saw.
 */
const importNotice = ref<GraphicStyleSetPackagePreflightReport | null>(null);

const importIssues = computed(() => pendingImport.value?.report.issues ?? []);
const importRejected = computed(() => pendingImport.value?.report.outcome === 'rejected');
const importAwaitingConfirmation = computed(() =>
	pendingImport.value?.report.outcome === 'requires-confirmation',
);
/**
 * Whether an independent copy is worth offering.
 *
 * Only for a package this installation refused because of how it relates to what is
 * already here. A malformed archive, an unreadable document, or a font this
 * installation does not have is no more installable as a copy than as an update, and
 * offering one would invite an author to retry something that cannot work.
 */
const RESOLVABLE_BY_COPY = new Set<GraphicStyleSetPackageErrorCode>([
	'graphic-style-set-revision-conflict',
	'graphic-style-set-revision-superseded',
	'graphic-style-set-identity-unpublished',
]);
const importResolvableAsCopy = computed(() =>
	pendingImport.value?.resolution === 'preserve-identity'
	&& importIssues.value.some(issue =>
		RESOLVABLE_BY_COPY.has(issue.code as GraphicStyleSetPackageErrorCode),
	),
);

function dismissImport() {
	pendingImport.value = null;
}

async function receivePackage(file: File, resolution: GraphicStyleSetPackageResolution) {
	if (!canAuthor.value)
		return;
	importing.value = true;
	pendingImport.value = null;
	importNotice.value = null;
	try {
		const report = await repository.inspectPackage(file, resolution);
		error.value = null;
		if (report.outcome !== 'ready') {
			// Rejected, or paused for the one confirmation it is entitled to ask for.
			pendingImport.value = { file, resolution, report };
			return;
		}
		const installation = await repository.installPackage(file, { resolution });
		// Nothing was asked, so nothing is waiting on the author — but a ready report
		// with findings is still a report they are entitled to read.
		if (installation.report.issues.length > 0)
			importNotice.value = installation.report;
		emit('published');
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		importing.value = false;
	}
}

async function confirmImport() {
	const pending = pendingImport.value;
	if (!canAuthor.value || !pending)
		return;
	importing.value = true;
	try {
		await repository.installPackage(pending.file, {
			resolution: pending.resolution,
			fingerprint: pending.report.fingerprint,
		});
		pendingImport.value = null;
		error.value = null;
		emit('published');
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		importing.value = false;
	}
}

/**
 * Ask for the same package again as an independent copy.
 *
 * A fresh report rather than a re-decision, because the two resolutions are different
 * proposals: one publishes over a Style Set every linked template resolves against and
 * the other creates something nothing links to. An author confirms the one they are
 * actually being shown.
 */
function importAsCopy() {
	const pending = pendingImport.value;
	if (pending)
		void receivePackage(pending.file, 'independent-copy');
}

/** Unlinking keeps every value the Style Set produced and drops only the provenance. */
function unlink() {
	const graphic = props.selectedGraphic;
	if (!canAuthor.value || !graphic)
		return;
	emit('update:graphic', detachGraphicStyleRefs(graphic, null));
}

onMounted(() => {
	void refresh();
});
</script>

<template>
	<ScreenSettingsCard title="Graphic Style Sets" data-testid="style-set-library">
		<div class="space-y-3">
			<p class="text-xs text-muted">
				Shared palettes, typography, fills, surfaces, media treatments, geometry, and motion,
				used across designs that travel independently.
			</p>

			<UAlert
				v-if="error"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Graphic Style Set action failed"
				:description="error"
				data-testid="style-set-error"
			/>

			<div v-if="issues.length > 0" class="rounded-md border border-error/40 bg-error/10 p-2" data-testid="style-set-publish-issues">
				<p class="text-xs font-semibold">
					This draft cannot be published yet
				</p>
				<ul class="mt-1 space-y-0.5">
					<li v-for="issue in issues" :key="`${issue.code}-${issue.entryId}`" class="text-xs">
						{{ issue.message }}
					</li>
				</ul>
			</div>

			<div v-if="canAuthor" class="flex gap-1.5">
				<UInput
					v-model="newName"
					size="xs"
					class="min-w-0 flex-1"
					placeholder="New Style Set name"
					aria-label="New Graphic Style Set name"
					data-testid="style-set-new-name"
				/>
				<UButton
					size="xs"
					variant="soft"
					icon="i-lucide-plus"
					:disabled="busy || newName.trim().length === 0"
					data-testid="style-set-create"
					@click="create"
				>
					Create
				</UButton>
			</div>

			<!--
				Receiving a style from elsewhere. The chosen archive is asked for as
				`preserve-identity` — the packaged Style Set identity and revision are kept
				rather than an unlinked copy being made, which is what separates this from
				installing a Template Package. An independent copy is offered below, and only
				once a package has been refused for conflicting with what is already here.
			-->
			<GraphicsPackageImport
				package-noun="Graphic Style Set Package"
				accept=".skstyle"
				test-id="style-set-import"
				:writable="canAuthor"
				:busy="importing"
				:reported="!!pendingImport"
				:issues="importIssues"
				:rejected="importRejected"
				:awaiting-confirmation="importAwaitingConfirmation"
				@file="receivePackage($event, 'preserve-identity')"
				@confirm="confirmImport"
				@dismiss="dismissImport"
			>
				<template #detail>
					<ul
						v-if="pendingImport && pendingImport.report.publishIssues.length > 0"
						class="mt-1 space-y-0.5"
					>
						<li
							v-for="issue in pendingImport.report.publishIssues"
							:key="`${issue.code}-${issue.entryId}`"
							class="text-xs text-muted"
						>
							{{ issue.message }}
						</li>
					</ul>
				</template>

				<template #actions>
					<!--
						A package refused only because of how it relates to what is already here
						can still be taken as an independent copy, with a new identity nothing
						links to yet.
					-->
					<UButton
						v-if="importResolvableAsCopy"
						size="xs"
						variant="subtle"
						icon="i-lucide-copy"
						:loading="importing"
						:disabled="importing"
						data-testid="style-set-import-as-copy"
						@click="importAsCopy"
					>
						Install as an independent copy
					</UButton>
				</template>
			</GraphicsPackageImport>

			<!--
				What an import that asked nothing still had to say. There is no decision here
				and nothing to undo, so it is stated afterwards rather than as a prompt — but
				it is stated: an author whose library records this Style Set under a different
				name learns it here or not at all.
			-->
			<div
				v-if="importNotice"
				class="rounded-md border border-default/70 bg-elevated/40 p-2"
				data-testid="style-set-import-notice"
			>
				<p class="text-xs font-medium">
					{{ importNotice.disposition === 'already-installed'
						? 'This Graphic Style Set Package was already installed'
						: 'This Graphic Style Set Package was installed' }}
				</p>
				<ul class="mt-1 space-y-1">
					<li
						v-for="(issue, index) in importNotice.issues"
						:key="`${issue.code}-${index}`"
						class="text-xs text-muted"
					>
						{{ issue.message }}<span v-if="issue.remediation"> — {{ issue.remediation }}</span>
					</li>
				</ul>
				<UButton
					class="mt-2"
					size="xs"
					color="neutral"
					variant="ghost"
					data-testid="style-set-import-notice-dismiss"
					@click="importNotice = null"
				>
					Dismiss
				</UButton>
			</div>

			<UIEmptyState
				v-if="styleSets.length === 0 && !loading"
				icon="i-lucide-palette"
				title="No Graphic Style Sets"
				description="Create one to share a visual and motion language between designs."
			/>

			<div v-else class="space-y-1.5">
				<div
					v-for="styleSet in styleSets"
					:key="styleSet.id"
					class="rounded-lg border border-default/70 bg-muted/20 p-2"
					:data-style-set-id="styleSet.id"
				>
					<div class="flex items-start gap-2">
						<UIcon name="i-lucide-palette" class="mt-1 size-4 shrink-0 text-muted" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">
								{{ styleSet.name }}
							</p>
							<p class="mt-0.5 truncate text-xs text-muted">
								{{ styleSet.entryCount }} entries ·
								{{ styleSet.revision === 0 ? 'never published' : `revision ${styleSet.revision}` }}
							</p>
						</div>
						<UBadge
							v-if="styleSet.hasUnpublishedChanges"
							color="warning"
							variant="subtle"
							size="sm"
							data-testid="style-set-unpublished"
						>
							Draft
						</UBadge>
						<UBadge
							v-if="linkedId === styleSet.id"
							color="primary"
							variant="subtle"
							size="sm"
							data-testid="style-set-linked"
						>
							Linked
						</UBadge>
					</div>

					<div class="mt-2 flex flex-wrap gap-1.5">
						<UButton
							size="xs"
							variant="subtle"
							icon="i-lucide-pencil"
							:disabled="busy"
							data-testid="style-set-open"
							@click="openStyleSet(styleSet.id)"
						>
							{{ open?.id === styleSet.id ? 'Editing' : 'Edit' }}
						</UButton>
						<!--
							The browser downloads the package directly. A Style Set that has
							never been published has no snapshot to freeze, so there is nothing
							to offer until it has one.
						-->
						<UButton
							v-if="styleSet.revision > 0"
							size="xs"
							color="neutral"
							variant="ghost"
							icon="i-lucide-package"
							:to="repository.packageUrl(styleSet.id)"
							external
							download
							:aria-label="`Export ${styleSet.name}`"
							data-testid="style-set-export"
						/>
						<UButton
							v-if="canAuthor && selectedGraphic && linkedId !== styleSet.id"
							size="xs"
							variant="subtle"
							icon="i-lucide-link"
							:disabled="busy || styleSet.revision === 0"
							:title="styleSet.revision === 0 ? 'Publish this Style Set before linking to it' : undefined"
							data-testid="style-set-link"
							@click="link(styleSet)"
						>
							Link
						</UButton>
						<UButton
							v-if="canAuthor && selectedGraphic && linkedId === styleSet.id"
							size="xs"
							color="neutral"
							variant="ghost"
							icon="i-lucide-unlink"
							:disabled="busy"
							data-testid="style-set-unlink"
							@click="unlink"
						>
							Unlink
						</UButton>
					</div>
				</div>
			</div>

			<!-- The open Style Set's working draft. -->
			<div v-if="open" class="rounded-lg border border-default/70 p-2" data-testid="style-set-editor">
				<div class="flex items-center justify-between gap-2">
					<p class="truncate text-sm font-semibold">
						{{ open.name }}
					</p>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						icon="i-lucide-x"
						aria-label="Close the Style Set editor"
						@click="open = null"
					/>
				</div>

				<div v-if="canAuthor" class="mt-2 flex gap-1.5">
					<USelect
						v-model="newEntryKind"
						:items="KIND_OPTIONS"
						value-key="value"
						size="xs"
						class="min-w-0 flex-1"
						aria-label="New entry kind"
						data-testid="style-entry-kind"
					/>
					<UButton
						size="xs"
						variant="soft"
						icon="i-lucide-plus"
						:disabled="busy"
						data-testid="style-entry-add"
						@click="addEntry"
					>
						Add
					</UButton>
				</div>

				<div class="mt-2 space-y-2">
					<div
						v-for="entry in open.draft"
						:key="entry.id"
						class="rounded-md border border-default/60 p-2"
						:data-entry-id="entry.id"
					>
						<div class="flex items-center gap-1.5">
							<UInput
								:model-value="entry.name"
								size="xs"
								class="min-w-0 flex-1"
								:disabled="!canAuthor"
								aria-label="Entry name"
								data-testid="style-entry-name"
								@change="renameEntry(entry.id, ($event.target as HTMLInputElement).value)"
							/>
							<UBadge color="neutral" variant="subtle" size="sm">
								{{ KIND_LABELS[entry.kind] }}
							</UBadge>
							<UButton
								v-if="canAuthor"
								size="xs"
								color="neutral"
								variant="ghost"
								icon="i-lucide-trash-2"
								:aria-label="`Delete ${entry.name}`"
								data-testid="style-entry-delete"
								@click="pendingDeleteEntryId = pendingDeleteEntryId === entry.id ? null : entry.id"
							/>
						</div>

						<GraphicsStyleSetEntryEditor
							class="mt-2"
							:entry="entry"
							:entries="open.draft"
							:writable="canAuthor"
							@update:value="updateEntryValue(entry.id, $event)"
						/>

						<!--
							Deleting an entry is one atomic operation across the Style Set and every
							template that references it, so the author says up front what those
							references become.
						-->
						<div
							v-if="pendingDeleteEntryId === entry.id"
							class="mt-2 rounded-md border border-error/40 bg-error/10 p-2"
							data-testid="style-entry-delete-confirm"
						>
							<p class="text-xs">
								Replace every reference to “{{ entry.name }}”, or detach them and keep the
								values they currently produce. Nothing on air changes either way.
							</p>
							<div class="mt-2 space-y-1.5">
								<USelect
									v-model="replacementEntryId"
									:items="replacementOptions"
									value-key="value"
									size="xs"
									class="w-full"
									placeholder="Replace with…"
									aria-label="Replacement entry"
									data-testid="style-entry-replacement"
								/>
								<div class="flex gap-1.5">
									<UButton
										size="xs"
										color="error"
										variant="subtle"
										:disabled="busy || !replacementEntryId"
										data-testid="style-entry-delete-replace"
										@click="deleteEntry('replace')"
									>
										Replace
									</UButton>
									<UButton
										size="xs"
										color="error"
										variant="subtle"
										:disabled="busy"
										data-testid="style-entry-delete-detach"
										@click="deleteEntry('detach')"
									>
										Detach
									</UButton>
									<UButton
										size="xs"
										color="neutral"
										variant="ghost"
										@click="pendingDeleteEntryId = null"
									>
										Cancel
									</UButton>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div v-if="canAuthor" class="mt-3 flex flex-wrap gap-1.5">
					<UButton
						size="xs"
						icon="i-lucide-upload"
						:disabled="busy"
						data-testid="style-set-publish"
						@click="publish"
					>
						Publish
					</UButton>
					<UButton
						size="xs"
						color="error"
						variant="ghost"
						icon="i-lucide-trash-2"
						:disabled="busy"
						data-testid="style-set-delete"
						@click="removeStyleSet"
					>
						Delete Style Set
					</UButton>
				</div>

				<!--
					Publishing reaches templates and writes none of them. Saying which ones,
					and which of them actually move, is what turns "published" into something
					an author can act on.
				-->
				<div v-if="affected" class="mt-2 rounded-md border border-default/60 p-2" data-testid="style-set-affected">
					<p class="text-xs font-semibold">
						{{ affected.filter(template => template.styleChanged).length }}
						of {{ affected.length }} linked templates have an update to review
					</p>
					<ul class="mt-1 space-y-0.5">
						<li v-for="template in affected" :key="template.id" class="text-xs text-muted">
							{{ template.name }} — {{ template.styleChanged ? 'update available' : 'unchanged' }}
						</li>
					</ul>
				</div>
			</div>
		</div>
	</ScreenSettingsCard>
</template>
