<script setup lang="ts">
import type {
	GraphicAssetPurgeOutcome,
	GraphicsDiscrepancyActionOutcome,
	GraphicsOperationalQueueItem,
	GraphicsOperationalQueuesOverview,
	GraphicsQueueInspection,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsOperationalQueueId,
	GraphicsQueueAction,
	GraphicsQueueActionOutcome,
} from '~~/shared/utils/graphicsOperationalQueues';
import type { GraphicsStorageHealthAlertSeverity } from '~~/shared/utils/graphicsOperationsCockpit';
import { formatByteCount } from '~~/shared/utils/formatByteCount';
import {
	graphicsDiscrepancyQueueOutcome,
	graphicsPurgeQueueOutcome,
	graphicsQueueOutcomeFromStatus,
} from '~~/shared/utils/graphicsOperationalQueues';

definePageMeta({
	title: 'Graphics Queues',
});

/**
 * Every queue and every inspection is read from durable server state, so an
 * incident, a deadline, and a valid action all survive navigation and reload
 * without this page remembering anything of its own. The one thing it does keep
 * is which item is selected, and it keeps that in the address rather than in
 * memory so a reload lands on the same item.
 */
const route = useRoute();
const router = useRouter();

const inspection = ref<GraphicsQueueInspection | null>(null);
const inspectionError = ref<string | null>(null);
const actionPending = ref<GraphicsQueueAction | null>(null);
const actionOutcome = ref<GraphicsQueueActionOutcome | null>(null);
const actionDetail = ref<string | null>(null);
const purgeRequested = ref(false);
const purgeConfirmation = ref('');
const repairRequested = ref(false);

/**
 * Which item is selected.
 *
 * The address is the durable copy and this is the working one: a selection made
 * here is mirrored into the query so a reload, a shared link, or a return from
 * another page lands on the same item, and the query is read back once on setup
 * to restore it. Reading the address itself on every render would tie what is on
 * screen to router timing for no gain.
 */
function selectionFromRoute() {
	const queue = route.query.queue;
	const item = route.query.item;
	return typeof queue === 'string' && typeof item === 'string'
		? { queue: queue as GraphicsOperationalQueueId, subjectId: item }
		: null;
}

const selection = ref(selectionFromRoute());

const {
	administratorToken,
	reading: queues,
	loadPending,
	loadError,
	hasReading,
	administratorHeaders,
	describeFailure,
	statusOf,
	isAuthorizationFailure,
	load: loadQueues,
} = useGraphicsAdminReading<GraphicsOperationalQueuesOverview>({
	read: async headers => await $fetch<GraphicsOperationalQueuesOverview>(
		'/api/admin/graphics-assets/queues',
		{ headers },
	),
	failureMessage: 'The operational queues could not be read.',
	onAuthorizationLost: () => {
		inspection.value = null;
	},
	onReading: async () => {
		if (selection.value)
			await loadInspection();
	},
});

/**
 * Reads the selected item afresh rather than reusing the row the list showed.
 * A subject that has left its queue answers 404, which is the honest result: the
 * inspector must never describe a subject in a state it has already left.
 */
async function loadInspection() {
	const selected = selection.value;
	if (!selected) {
		inspection.value = null;
		return;
	}
	inspectionError.value = null;
	try {
		inspection.value = await $fetch<GraphicsQueueInspection>(
			'/api/admin/graphics-assets/queues/inspection',
			{
				headers: administratorHeaders(),
				query: { queue: selected.queue, subjectId: selected.subjectId },
			},
		);
	}
	catch (caught) {
		inspection.value = null;
		inspectionError.value = statusOf(caught) === 404
			? 'This item is no longer in that queue.'
			: describeFailure(caught, 'The item could not be inspected.');
	}
}

async function select(item: GraphicsOperationalQueueItem) {
	actionOutcome.value = null;
	actionDetail.value = null;
	purgeRequested.value = false;
	purgeConfirmation.value = '';
	repairRequested.value = false;
	selection.value = { queue: item.queue, subjectId: item.subject.id };
	await router.replace({
		query: { queue: item.queue, item: item.subject.id },
	});
	await loadInspection();
}

/** Named for what is wrong, never for the provider object underneath. */
const QUEUE_LABELS: Record<GraphicsOperationalQueueId, string> = {
	'critical-integrity-incident': 'Critical Integrity Incidents',
	'unavailable-content': 'Unavailable Content',
	'missing-derivative': 'Missing Graphics Derivatives',
	'retryable-ingestion': 'Retryable ingestion',
	'expired-ingestion-input': 'Expired staged input',
	'trashed-asset': 'Trash awaiting purge',
	'superseded-revision': 'Superseded revisions',
	'quarantined-object': 'Quarantined objects',
	'retired-asset': 'Retired Graphic Assets',
};

const QUEUE_SUMMARIES: Record<GraphicsOperationalQueueId, string> = {
	'critical-integrity-incident':
		'Stored bytes contradict the digest that owns their key. Isolated, never repaired in place.',
	'unavailable-content':
		'The catalogue expects content whose bytes do not currently resolve. Exact-byte repair only.',
	'missing-derivative':
		'A deterministic preview is missing and can be regenerated from its source revision.',
	'retryable-ingestion':
		'Resumable from retained verified input, with no bytes retransmitted.',
	'expired-ingestion-input':
		'Staged input passed its retention guarantee. A new operation is required.',
	'trashed-asset':
		'Restorable to its prior state until its recovery window ends.',
	'superseded-revision':
		'Unreferenced and awaiting pruning. A new reference cancels it.',
	'quarantined-object':
		'Bytes the catalogue never expected, held for recheck and never adopted.',
	'retired-asset':
		'Hidden from discovery while every existing reference still resolves. Reversible, no deadline.',
};

const ACTION_LABELS: Record<GraphicsQueueAction, string> = {
	'recheck': 'Recheck',
	'verify-stored-bytes': 'Verify stored bytes',
	'repair-with-exact-bytes': 'Repair with exact bytes',
	'regenerate-derivative': 'Regenerate derivative',
	'retry-ingestion': 'Retry from retained input',
	'restore-graphic-asset': 'Restore',
	'purge-now': 'Purge now',
};

const OUTCOME_LABELS: Record<GraphicsQueueActionOutcome, string> = {
	'completed': 'Completed',
	'already-in-state': 'Already in state',
	'reference-blocked': 'Reference blocked',
	'retryable-unavailable': 'Retryable — unavailable',
	'integrity-conflict': 'Integrity conflict',
};

const OUTCOME_SUMMARIES: Record<GraphicsQueueActionOutcome, string> = {
	'completed': 'The action changed durable state and the subject left this queue.',
	'already-in-state': 'The subject was already in the state this action asks for.',
	'reference-blocked': 'A fresh reference proof found pinned usage, so nothing was reclaimed.',
	'retryable-unavailable': 'Nothing has been put right yet. The same action is worth running again once the bytes or the component behind it answer.',
	'integrity-conflict': 'The library refused rather than write over a disagreement. It fails closed.',
};

function severityColor(severity: GraphicsStorageHealthAlertSeverity) {
	return severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info';
}

function outcomeColor(outcome: GraphicsQueueActionOutcome) {
	return outcome === 'completed'
		? 'success'
		: outcome === 'already-in-state' ? 'neutral' : 'error';
}

function formatInstant(instant: string | undefined) {
	return instant ? new Date(instant).toLocaleString() : 'None';
}

function isSelected(item: GraphicsOperationalQueueItem) {
	return selection.value?.queue === item.queue
		&& selection.value.subjectId === item.subject.id;
}

/**
 * What the byte store reported, kept separate from what the catalogue expects.
 * "Could not answer" is not the same finding as "is not there", and collapsing
 * them would turn a retryable outage into a missing object.
 */
function byteEvidence(observed: {
	present: boolean;
	byteLength?: number;
	canonicalMime?: string;
	byteStoreUnavailable?: boolean;
}) {
	if (observed.byteStoreUnavailable)
		return 'The byte store could not answer. This is retryable.';
	if (!observed.present)
		return 'No bytes present at the expected identity.';
	return `${formatByteCount(observed.byteLength ?? 0)}`
		+ `${observed.canonicalMime ? ` · ${observed.canonicalMime}` : ''}`;
}

const discrepancyDetail = computed(() =>
	inspection.value?.detail.kind === 'graphics-discrepancy'
		? inspection.value.detail.discrepancy
		: null);

const assetDetail = computed(() =>
	inspection.value?.detail.kind === 'graphic-asset' ? inspection.value.detail : null);

const revisionDetail = computed(() =>
	inspection.value?.detail.kind === 'graphic-asset-revision' ? inspection.value.detail : null);

const operationDetail = computed(() =>
	inspection.value?.detail.kind === 'graphics-ingestion-operation'
		? inspection.value.detail.operation
		: null);

const purgeConfirmed = computed(() => purgeConfirmation.value === 'purge-now');

function report(outcome: GraphicsQueueActionOutcome, detail?: string) {
	actionOutcome.value = outcome;
	actionDetail.value = detail ?? null;
}

/**
 * Runs one queue action and reports it in the five-outcome vocabulary.
 *
 * Nothing here decides an outcome of its own: a refusal the library already
 * classified is mapped, and a status it answered with is mapped, so the same
 * action run twice reads as `already-in-state` rather than as an error.
 */
async function run(action: GraphicsQueueAction, perform: () => Promise<GraphicsQueueActionOutcome>) {
	actionPending.value = action;
	actionOutcome.value = null;
	actionDetail.value = null;
	try {
		report(await perform());
	}
	catch (caught) {
		// A token that stopped being accepted is not a domain outcome. Reporting
		// one would tell an administrator the library considered their action and
		// answered, when in fact it never looked at it.
		if (isAuthorizationFailure(caught)) {
			await loadQueues();
			return;
		}
		const status = statusOf(caught);
		report(
			status === undefined ? 'retryable-unavailable' : graphicsQueueOutcomeFromStatus(status),
			describeFailure(caught, 'The action could not be completed.'),
		);
	}
	finally {
		actionPending.value = null;
		// Both the queues and the item are re-read from the server rather than
		// patched here, so what is on screen is always what the library holds.
		await loadQueues();
	}
}

async function runDiscrepancyAction(action: GraphicsQueueAction) {
	const subjectId = inspection.value?.subject.id;
	if (!subjectId)
		return;
	await run(action, async () => graphicsDiscrepancyQueueOutcome(
		await $fetch<GraphicsDiscrepancyActionOutcome>(
			`/api/admin/graphics-assets/discrepancies/${subjectId}/actions`,
			{ method: 'POST', headers: administratorHeaders(), body: { action } },
		),
	));
}

async function repairWithExactBytes(fileEvent: Event) {
	const file = (fileEvent.target as HTMLInputElement).files?.[0];
	const subjectId = inspection.value?.subject.id;
	if (!file || !subjectId)
		return;
	await run('repair-with-exact-bytes', async () => graphicsDiscrepancyQueueOutcome(
		await $fetch<GraphicsDiscrepancyActionOutcome>(
			`/api/admin/graphics-assets/discrepancies/${subjectId}/repair`,
			{ method: 'PUT', headers: administratorHeaders(), body: file },
		),
	));
	repairRequested.value = false;
}

async function restoreGraphicAsset() {
	const subjectId = inspection.value?.subject.id;
	if (!subjectId)
		return;
	await run('restore-graphic-asset', async () => (await $fetch<{
		outcome: GraphicsQueueActionOutcome;
	}>(
		`/api/admin/graphics-assets/${subjectId}/lifecycle-actions`,
		{ method: 'POST', headers: administratorHeaders(), body: { action: 'restore' } },
	)).outcome);
}

async function retryIngestion() {
	const operation = operationDetail.value;
	if (!operation)
		return;
	await run('retry-ingestion', async () => (await $fetch<{
		outcome: GraphicsQueueActionOutcome;
	}>(
		`/api/admin/graphics-assets/ingestion-operations/${operation.operationId}/retry`,
		{ method: 'POST', headers: administratorHeaders() },
	)).outcome);
}

/**
 * Early purge is the one action that destroys restorable state, so it is the
 * one action that asks first. The confirmation is typed rather than clicked,
 * and the endpoint proves usage afresh across every revision regardless.
 */
async function confirmEarlyPurge() {
	const subjectId = inspection.value?.subject.id;
	if (!subjectId || !purgeConfirmed.value)
		return;
	await run('purge-now', async () => graphicsPurgeQueueOutcome(
		await $fetch<GraphicAssetPurgeOutcome>(
			`/api/admin/graphics-assets/${subjectId}/purge`,
			{
				method: 'POST',
				headers: administratorHeaders(),
				body: { confirmation: 'purge-now' },
			},
		),
	));
	purgeRequested.value = false;
	purgeConfirmation.value = '';
}

function actionHandler(action: GraphicsQueueAction) {
	if (action === 'purge-now')
		return () => { purgeRequested.value = true; };
	if (action === 'repair-with-exact-bytes')
		return () => { repairRequested.value = true; };
	if (action === 'restore-graphic-asset')
		return restoreGraphicAsset;
	if (action === 'retry-ingestion')
		return retryIngestion;
	return () => runDiscrepancyAction(action);
}
</script>

<template>
	<NuxtLayout name="default">
		<template #actions>
			<UButton
				color="neutral"
				variant="outline"
				icon="i-lucide-refresh-cw"
				:loading="loadPending"
				:disabled="!hasReading"
				@click="loadQueues"
			>
				Refresh
			</UButton>
		</template>

		<div class="mx-auto flex w-full max-w-7xl flex-col gap-6">
			<div>
				<h1 class="text-2xl font-semibold text-highlighted">
					Graphics lifecycle and reconciliation queues
				</h1>
				<p class="mt-1 text-sm text-muted">
					What needs doing, most urgent first, with only the actions valid in each state.
				</p>
			</div>

			<UCard v-if="!hasReading">
				<template #header>
					<h2 class="font-semibold text-highlighted">
						Graphics Administrator access
					</h2>
				</template>
				<div class="flex flex-col gap-4">
					<UFormField
						label="Graphics Administrator token"
						description="The queues are administrator-only. The token is held for this session only and never stored."
					>
						<UInput
							v-model="administratorToken"
							type="password"
							autocomplete="current-password"
						/>
					</UFormField>
					<div>
						<UButton
							label="Open queues"
							icon="i-lucide-list-checks"
							:loading="loadPending"
							@click="loadQueues"
						/>
					</div>
					<p v-if="loadError" class="text-sm text-error">
						{{ loadError }}
					</p>
				</div>
			</UCard>

			<template v-if="queues">
				<UAlert
					v-if="loadError"
					color="error"
					variant="soft"
					icon="i-lucide-triangle-alert"
					title="The last reading failed"
					:description="loadError"
				/>

				<UAlert
					color="neutral"
					variant="soft"
					icon="i-lucide-scale"
					title="Who decides what"
					description="The D1 catalogue decides what the library expects to reach. The byte store decides which bytes exist right now. The availability flag is advisory reconciliation state and is never a read authority."
				/>

				<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
					<!-- Risk-ordered queues: most severe first, then nearest deadline. -->
					<section class="flex flex-col gap-4">
						<UCard v-for="queue in queues.queues" :key="queue.id">
							<template #header>
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h2 class="font-semibold text-highlighted">
										{{ QUEUE_LABELS[queue.id] }}
									</h2>
									<div class="flex items-center gap-2">
										<UBadge
											:color="severityColor(queue.severity)"
											variant="soft"
											:label="queue.severity"
										/>
										<UBadge
											variant="subtle"
											color="neutral"
											:label="`${queue.totalCount}`"
										/>
									</div>
								</div>
							</template>

							<p class="text-sm text-muted">
								{{ QUEUE_SUMMARIES[queue.id] }}
							</p>
							<p v-if="queue.nextDeadline" class="mt-2 text-xs text-dimmed">
								Next deadline {{ formatInstant(queue.nextDeadline) }}
							</p>
							<p v-else-if="queue.id === 'retired-asset'" class="mt-2 text-xs text-dimmed">
								Reversible, no deadline
							</p>

							<p v-if="queue.items.length === 0" class="mt-3 text-sm text-dimmed">
								Nothing in this queue.
							</p>
							<ul v-else class="mt-3 flex flex-col gap-2">
								<li v-for="item in queue.items" :key="item.key">
									<UButton
										block
										:color="isSelected(item) ? 'primary' : 'neutral'"
										:variant="isSelected(item) ? 'soft' : 'ghost'"
										class="justify-start text-left"
										@click="select(item)"
									>
										{{ item.title }}
									</UButton>
									<p class="mt-1 pl-3 text-xs text-dimmed">
										<span v-if="item.deadline">
											Deadline {{ formatInstant(item.deadline) }}
										</span>
										<span v-else>No deadline</span>
										<span v-if="item.referenceCount !== undefined">
											· {{ item.referenceCount }} pinned references
										</span>
									</p>
								</li>
							</ul>
							<p
								v-if="queue.totalCount > queue.items.length"
								class="mt-3 text-xs text-dimmed"
							>
								Showing {{ queue.items.length }} of {{ queue.totalCount }}, nearest deadline first.
							</p>
						</UCard>
					</section>

					<!-- The persistent inspector: everything known about one selected item. -->
					<section class="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
						<UCard v-if="inspectionError">
							<p class="text-sm text-error">
								{{ inspectionError }}
							</p>
						</UCard>

						<UCard v-else-if="!inspection">
							<p class="text-sm text-muted">
								Select an item to inspect its evidence, deadline, and valid actions.
							</p>
						</UCard>

						<template v-else>
							<UCard>
								<template #header>
									<div class="flex flex-wrap items-center justify-between gap-2">
										<h2 class="font-semibold text-highlighted">
											{{ inspection.title }}
										</h2>
										<UBadge
											:color="severityColor(inspection.severity)"
											variant="soft"
											:label="QUEUE_LABELS[inspection.queue]"
										/>
									</div>
								</template>

								<dl class="grid gap-3 text-sm sm:grid-cols-2">
									<div>
										<dt class="text-xs text-dimmed">
											{{ inspection.subject.kind }}
										</dt>
										<dd class="font-mono text-xs break-all text-muted">
											{{ inspection.subject.id }}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-dimmed">
											Deadline
										</dt>
										<dd class="text-muted">
											<template v-if="inspection.deadline">
												{{ formatInstant(inspection.deadline) }}
											</template>
											<template v-else>
												Reversible, no deadline
											</template>
										</dd>
									</div>
									<div>
										<dt class="text-xs text-dimmed">
											Affected pinned usage
										</dt>
										<dd class="text-muted">
											{{ inspection.referenceCount }} pinned references
										</dd>
									</div>
								</dl>
							</UCard>

							<!-- What each side is authoritative for, never merged. -->
							<UCard v-if="discrepancyDetail">
								<template #header>
									<h3 class="font-semibold text-highlighted">
										Evidence
									</h3>
								</template>
								<dl class="grid gap-3 text-sm sm:grid-cols-2">
									<div>
										<dt class="text-xs text-dimmed">
											The catalogue expects
										</dt>
										<dd class="text-muted">
											{{ formatByteCount(discrepancyDetail.expected.byteLength) }}
											<span v-if="discrepancyDetail.expected.canonicalMime">
												· {{ discrepancyDetail.expected.canonicalMime }}
											</span>
										</dd>
									</div>
									<div>
										<dt class="text-xs text-dimmed">
											The byte store reported
										</dt>
										<dd class="text-muted">
											{{ byteEvidence(discrepancyDetail.observed) }}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-dimmed">
											Stable reason
										</dt>
										<dd class="text-muted">
											{{ discrepancyDetail.reasonCode }}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-dimmed">
											Last checked
										</dt>
										<dd class="text-muted">
											{{ formatInstant(discrepancyDetail.lastCheckedAt) }}
										</dd>
									</div>
								</dl>
								<p v-if="discrepancyDetail.isolated" class="mt-3 text-sm text-error">
									This incident fails closed and is isolated rather than repaired in place.
								</p>
								<p v-if="discrepancyDetail.quarantine" class="mt-3 text-sm text-muted">
									Quarantined {{ formatInstant(discrepancyDetail.quarantine.quarantinedAt) }};
									rechecked and deleted only if still unaccounted for after
									{{ formatInstant(discrepancyDetail.quarantine.deleteAfter) }}. It is never
									adopted as a Graphic Asset.
								</p>
								<ul
									v-if="discrepancyDetail.affectedUsage.length > 0"
									class="mt-3 flex flex-col gap-2 text-sm"
								>
									<li
										v-for="usage in discrepancyDetail.affectedUsage"
										:key="usage.revisionId"
										class="rounded-lg border border-muted p-2"
									>
										<span class="text-highlighted">{{ usage.assetName }}</span>
										<span class="text-muted">
											· revision {{ usage.revisionNumber }}
											· {{ usage.referenceCount }} pinned references
											· {{ usage.lifecycleState }}
										</span>
									</li>
								</ul>
							</UCard>

							<UCard v-if="assetDetail">
								<template #header>
									<h3 class="font-semibold text-highlighted">
										Lifecycle
									</h3>
								</template>
								<p class="text-sm text-muted">
									<template v-if="assetDetail.lifecycle.state === 'trashed'">
										In Trash since
										{{ formatInstant(assetDetail.lifecycle.trashedAt) }}.
										Restores to
										{{ assetDetail.lifecycle.priorState === 'retired' ? 'Retired' : 'active' }}.
									</template>
									<template v-else-if="assetDetail.lifecycle.state === 'retired'">
										Retired: hidden from discovery, taking no new references, while every
										existing reference still resolves.
									</template>
									<template v-else>
										Active and discoverable.
									</template>
								</p>
								<ul
									v-if="assetDetail.usage.length > 0"
									class="mt-3 flex flex-col gap-2 text-sm"
								>
									<li
										v-for="usage in assetDetail.usage"
										:key="usage.id"
										class="rounded-lg border border-muted p-2"
									>
										<span class="text-highlighted">
											{{ usage.owner.name ?? `${usage.owner.kind} ${usage.owner.id}` }}
										</span>
										<span class="text-muted"> · {{ usage.owner.slot }}</span>
									</li>
								</ul>
								<ul v-if="assetDetail.revisions.length > 0" class="mt-3 text-sm text-muted">
									<li v-for="revision in assetDetail.revisions" :key="revision.revisionId">
										Revision {{ revision.revisionNumber }} · {{ revision.retention.policy }}
									</li>
								</ul>
							</UCard>

							<UCard v-if="revisionDetail">
								<template #header>
									<h3 class="font-semibold text-highlighted">
										Retention
									</h3>
								</template>
								<p class="text-sm text-muted">
									Revision {{ revisionDetail.revisionNumber }} of
									<span class="font-mono text-xs">{{ revisionDetail.assetId }}</span>
									· {{ revisionDetail.retention.policy }}. Pruning is the retention sweep's own
									decision, and a new Graphic Asset Reference cancels it.
								</p>
							</UCard>

							<UCard v-if="operationDetail">
								<template #header>
									<h3 class="font-semibold text-highlighted">
										Graphics Ingestion Operation
									</h3>
								</template>
								<dl class="grid gap-3 text-sm sm:grid-cols-2">
									<div>
										<dt class="text-xs text-dimmed">
											Stage
										</dt>
										<dd class="text-muted">
											{{ operationDetail.stage }} · {{ operationDetail.source }}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-dimmed">
											Transferred
										</dt>
										<dd class="text-muted">
											{{ formatByteCount(operationDetail.transferredByteLength) }} of
											{{ formatByteCount(operationDetail.declaredByteLength) }}
											{{ operationDetail.transferComplete ? '(complete)' : '(in progress)' }}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-dimmed">
											Started by
										</dt>
										<dd class="text-muted">
											{{ operationDetail.initiatedBy }}
										</dd>
									</div>
									<div v-if="operationDetail.failureCode">
										<dt class="text-xs text-dimmed">
											Failure
										</dt>
										<dd class="text-muted">
											{{ operationDetail.failureCode }}
										</dd>
									</div>
								</dl>
							</UCard>

							<UCard>
								<template #header>
									<h3 class="font-semibold text-highlighted">
										Valid actions
									</h3>
								</template>
								<p v-if="inspection.actions.length === 0" class="text-sm text-muted">
									Nothing an administrator can do here is valid in this state.
								</p>
								<div v-else class="flex flex-wrap gap-2">
									<UButton
										v-for="action in inspection.actions"
										:key="action"
										:color="action === 'purge-now' ? 'error' : 'neutral'"
										variant="outline"
										:loading="actionPending === action"
										:label="ACTION_LABELS[action]"
										@click="actionHandler(action)()"
									/>
								</div>

								<div v-if="repairRequested" class="mt-4 flex flex-col gap-2">
									<p class="text-sm text-muted">
										Repair accepts only bytes matching the exact digest, size, and media type
										the catalogue already expects. It creates no revision and changes no
										reference.
									</p>
									<input type="file" @change="repairWithExactBytes">
								</div>

								<div v-if="purgeRequested" class="mt-4 flex flex-col gap-3">
									<UAlert
										color="error"
										variant="soft"
										icon="i-lucide-triangle-alert"
										title="Early purge is permanent"
										description="Purge removes every restorable trace of this Graphic Asset and permanently retires its local identity. The library proves usage afresh across all revisions first and refuses if anything still pins it."
									/>
									<UFormField label="Type purge-now to confirm">
										<UInput v-model="purgeConfirmation" placeholder="purge-now" />
									</UFormField>
									<div class="flex gap-2">
										<UButton
											color="error"
											:disabled="!purgeConfirmed"
											:loading="actionPending === 'purge-now'"
											label="Confirm early purge"
											@click="confirmEarlyPurge"
										/>
										<UButton
											color="neutral"
											variant="ghost"
											label="Cancel"
											@click="purgeRequested = false"
										/>
									</div>
								</div>

								<div v-if="actionOutcome" class="mt-4">
									<UBadge
										:color="outcomeColor(actionOutcome)"
										variant="soft"
										:label="OUTCOME_LABELS[actionOutcome]"
									/>
									<p class="mt-2 text-sm text-muted">
										{{ OUTCOME_SUMMARIES[actionOutcome] }}
									</p>
									<p v-if="actionDetail" class="mt-1 text-xs text-dimmed">
										{{ actionDetail }}
									</p>
								</div>
							</UCard>

							<UCard>
								<template #header>
									<h3 class="font-semibold text-highlighted">
										Evidence Ledger
									</h3>
								</template>
								<p v-if="inspection.evidence.length === 0" class="text-sm text-muted">
									The Evidence ledger holds nothing for this subject yet.
								</p>
								<ul v-else class="flex flex-col gap-2 text-sm">
									<li
										v-for="entry in inspection.evidence"
										:key="entry.id"
										class="rounded-lg border border-muted p-2"
									>
										<span class="text-highlighted">{{ entry.category }}</span>
										<span class="text-muted"> · {{ entry.outcome }} · {{ entry.reason }}</span>
										<span class="block text-xs text-dimmed">
											{{ entry.actor }} · {{ formatInstant(entry.recordedAt) }}
										</span>
									</li>
								</ul>
							</UCard>
						</template>
					</section>
				</div>

				<p class="text-xs text-dimmed">
					Last read {{ formatInstant(queues.checkedAt) }}
				</p>
			</template>
		</div>
	</NuxtLayout>
</template>
