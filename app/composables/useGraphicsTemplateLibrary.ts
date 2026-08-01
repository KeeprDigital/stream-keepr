import type { MaybeRefOrGetter, Ref } from 'vue';
import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import type { TemplatePackagePreflightIssue } from '~~/shared/types/templatePackage';

/**
 * The installation-scoped library of one graphics Template kind.
 *
 * Two libraries hold a graphics Template that travels as a **Template Package** — the
 * Broadcast Graphic Template library and the Feature Match Layout Template library — and
 * a Template Package means exactly the same thing in both. Template Package Installation
 * produces an Installed Graphics Template with its own installation-owned identity and
 * managed revision: an independent local copy that records the packaged Template's
 * identity as provenance only, with no live link to the installation that exported it.
 *
 * ## What this is deliberately not
 *
 * A **Graphic Style Set Package** is not a Template Package and does not import through
 * here. Its first import *preserves* the packaged Style Set identity and revision rather
 * than yielding an unlinked copy, and an independent copy is the fallback an author
 * explicitly asks for rather than the ordinary outcome (`CONTEXT.md`, "Graphic Style Set
 * Package"). `StyleSetLibrary.vue` therefore builds on `useReusableLibraryReading` and keeps its
 * own import path, where that choice is stated once and read at the call site. Folding
 * the two into a shared "install" path would quietly recreate the bug the separation
 * exists to prevent.
 *
 * ## Why importing is not one click
 *
 * Template Package Preflight can reach three conclusions and each needs a different thing
 * from the author: a rejection is terminal and explains itself, a clean proposal installs
 * straight away, and a proposal carrying warnings pauses exactly once for a confirmation
 * bound to that exact Preflight Report Fingerprint. Collapsing the last case into an
 * automatic install would silently accept, on the author's behalf, decisions like "this
 * content already exists here under a different name" — which are precisely the ones a
 * Template Package Preflight Report exists to put in front of them.
 */

/** What every graphics Template library entry carries, whichever kind it holds. */
export interface GraphicsTemplateSummary {
	id: string;
	name: string;
	description: string | null;
	revision: number;
	/**
	 * Whether this installation authored the entry. An entry a Template Package
	 * installed is the Graphics Asset Library's own record of what it published, and
	 * this library never writes one.
	 */
	authored: boolean;
}

/** The library reads and writes a graphics Template repository already offers. */
export interface GraphicsTemplateLibraryRepository<Entry> {
	list: () => Promise<Entry[]>;
	update: (
		templateId: string,
		patch: { name?: string; description?: string | null; revision: number },
	) => Promise<unknown>;
	remove: (templateId: string) => Promise<void>;
	receivePackage: (file: File) => Promise<GraphicsIngestionOperation>;
	confirmPackage: (operationId: string, fingerprint: string) => Promise<unknown>;
	installPackage: (operationId: string) => Promise<GraphicsIngestionOperation>;
}

/**
 * Receiving a Template Package, as the surface that shows one reads it.
 *
 * One noun rather than the eight members it was: every one of them exists to be wired
 * into `<GraphicsPackageImport>`, and both Template libraries wired all eight
 * identically and verbatim. Its keys are that component's own prop and event names, so
 * `GraphicsTemplateLibraryImport` states the wiring once.
 *
 * Reactive rather than an object of refs, so a surface reads `state.busy` rather than
 * `state.busy.value` — the same unwrapping a composable's own top-level bindings get.
 */
export interface GraphicsTemplatePackageImport {
	/** Whether a package is currently being received, confirmed, or installed. */
	busy: boolean;
	/** Whether a preflight report is waiting to be read. */
	reported: boolean;
	/** The issues an author is being asked to accept, or the reasons a package was refused. */
	issues: readonly TemplatePackagePreflightIssue[];
	/** Whether the report is terminal, so there is nothing to accept. */
	rejected: boolean;
	/** Whether the report is paused on the one confirmation it may ask for. */
	awaitingConfirmation: boolean;
	receive: (file: File) => Promise<void>;
	confirm: () => Promise<void>;
	dismiss: () => void;
}

export interface GraphicsTemplateLibrary<Entry> extends ReusableLibraryReading<Entry> {
	/** The entry a write is currently in flight against, if any. */
	busyTemplateId: Ref<string | null>;
	/** The entry whose deletion is awaiting confirmation, if any. */
	pendingDeleteId: Ref<string | null>;
	canRevise: (template: GraphicsTemplateSummary) => boolean;
	attempt: (templateId: string, work: () => Promise<void>) => Promise<void>;
	revise: (
		template: GraphicsTemplateSummary,
		patch: { name?: string; description?: string | null },
	) => Promise<void>;
	askToRemove: (templateId: string) => void;
	cancelRemove: () => void;
	remove: (templateId: string) => Promise<void>;
	packageImport: GraphicsTemplatePackageImport;
}

export function useGraphicsTemplateLibrary<Entry extends GraphicsTemplateSummary>(options: {
	repository: GraphicsTemplateLibraryRepository<Entry>;
	/** Whether this session may author. Fail closed: an unstated permission is never permission. */
	canAuthor: MaybeRefOrGetter<boolean>;
	/** What to say when a failure carries no message of its own. */
	unavailable: string;
}): GraphicsTemplateLibrary<Entry> {
	const { repository } = options;
	const library = useReusableLibraryReading<Entry>({
		read: () => repository.list(),
		unavailable: options.unavailable,
	});
	const { error, failureMessage, refresh } = library;

	const busyTemplateId = ref<string | null>(null);
	const pendingDeleteId = ref<string | null>(null);

	const authorises = () => toValue(options.canAuthor);

	/**
	 * Whether this entry can be renamed, described, or deleted here.
	 *
	 * Two conditions, and they are separate questions: whether this session may author at
	 * all, and whether *this design* is one the library owns. An entry a Template Package
	 * installed is browsed, placed, and exported like any other, and changed by placing it
	 * and saving the placed copy.
	 */
	function canRevise(template: GraphicsTemplateSummary): boolean {
		return authorises() && template.authored;
	}

	/**
	 * Run one write against a single entry, holding it busy and reporting a refusal in the
	 * one place an author reads them.
	 */
	async function attempt(templateId: string, work: () => Promise<void>): Promise<void> {
		if (!authorises())
			return;
		busyTemplateId.value = templateId;
		try {
			await work();
			error.value = null;
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
	 * The stored revision travels with the write, so two authors who both had the library
	 * open cannot silently overwrite one another: the second is told the template has
	 * moved on and the list is re-read.
	 */
	async function revise(
		template: GraphicsTemplateSummary,
		patch: { name?: string; description?: string | null },
	): Promise<void> {
		if (!authorises())
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

	/**
	 * Deleting an entry is irreversible and there is no undo, so the first click asks and
	 * the second one does it.
	 */
	function askToRemove(templateId: string) {
		if (!authorises())
			return;
		pendingDeleteId.value = pendingDeleteId.value === templateId ? null : templateId;
	}

	function cancelRemove() {
		pendingDeleteId.value = null;
	}

	async function remove(templateId: string): Promise<void> {
		if (!authorises())
			return;
		busyTemplateId.value = templateId;
		try {
			await repository.remove(templateId);
			error.value = null;
			pendingDeleteId.value = null;
			// Last, so a library that then fails to re-read says so rather than being
			// overwritten by this write's own success.
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

	const importing = ref(false);
	const pendingImport = ref<GraphicsIngestionOperation | null>(null);

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

	async function importPackage(file: File): Promise<void> {
		if (!authorises())
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

	async function confirmImport(): Promise<void> {
		const operation = pendingImport.value;
		const fingerprint = operation?.templatePackagePreflight?.fingerprint;
		if (!authorises() || !operation || !fingerprint)
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

	return {
		...library,
		busyTemplateId,
		pendingDeleteId,
		canRevise,
		attempt,
		revise,
		askToRemove,
		cancelRemove,
		remove,
		packageImport: reactive({
			busy: importing,
			reported: computed(() => pendingImport.value !== null),
			issues: importIssues,
			rejected: importRejected,
			awaitingConfirmation: importAwaitingConfirmation,
			receive: importPackage,
			confirm: confirmImport,
			dismiss: dismissImport,
		}),
	};
}
