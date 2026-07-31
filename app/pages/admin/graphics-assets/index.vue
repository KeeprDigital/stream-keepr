<script setup lang="ts">
import type {
	GraphicsIngestionAttentionItem,
	GraphicsLibraryComponentCondition,
	GraphicsOperationsCockpit,
	GraphicsReconciliationSweepResult,
	GraphicsRetentionSweepResult,
	GraphicsStorageHealthAlert,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsRecentOutcomeGroup,
	GraphicsStorageHealthAlertSeverity,
} from '~~/shared/utils/graphicsOperationsCockpit';
import { formatByteCount } from '~~/shared/utils/formatByteCount';
import {
	GRAPHICS_INGESTION_ATTENTION_STATES,
	GRAPHICS_RECENT_OUTCOME_GROUPS,
} from '~~/shared/utils/graphicsOperationsCockpit';

definePageMeta({
	title: 'Graphics Operations',
});

/**
 * Everything on this page is read from durable server state on every poll, so
 * an incident, a deadline, and an operation's stage progress all survive
 * navigation, reload, and reconnect without the page remembering anything.
 */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const sweepPending = ref<'reconciliation' | 'retention' | null>(null);
const sweepSummary = ref<string | null>(null);
const sweepError = ref<string | null>(null);

const {
	administratorToken,
	reading: cockpit,
	loadPending,
	loadError,
	hasReading,
	administratorHeaders,
	describeFailure,
	load: loadCockpit,
} = useGraphicsAdminReading<GraphicsOperationsCockpit>({
	read: async headers => await $fetch<GraphicsOperationsCockpit>(
		'/api/admin/graphics-assets/operations-cockpit',
		{ headers },
	),
	failureMessage: 'The Operations Cockpit could not be read.',
});

/**
 * The two installation-wide actions that are valid from a cockpit. Neither can
 * shorten a recovery guarantee, which is why they are safe to offer here at all.
 */
async function runSweep(sweep: 'reconciliation' | 'retention') {
	sweepPending.value = sweep;
	sweepError.value = null;
	sweepSummary.value = null;
	try {
		if (sweep === 'reconciliation') {
			const result = await $fetch<GraphicsReconciliationSweepResult>(
				'/api/admin/graphics-assets/reconciliation',
				{ method: 'POST', headers: administratorHeaders() },
			);
			sweepSummary.value = `Reconciliation checked ${result.content.checked} contents, `
				+ `detected ${result.content.unavailableDetected} unavailable, `
				+ `and restored ${result.content.availabilityRestored}.`;
		}
		else {
			const result = await $fetch<GraphicsRetentionSweepResult>(
				'/api/admin/graphics-assets/retention',
				{ method: 'POST', headers: administratorHeaders() },
			);
			sweepSummary.value = `Retention pruned ${result.revisions.pruned} revisions and `
				+ `reclaimed ${formatByteCount(result.content.bytesReclaimed)}.`;
		}
		await loadCockpit();
	}
	catch (caught) {
		sweepError.value = describeFailure(caught, 'The sweep could not be run.');
	}
	finally {
		sweepPending.value = null;
	}
}

const conditions = computed(() => {
	const reading = cockpit.value;
	if (!reading)
		return [];
	return [
		{
			label: 'D1 catalogue',
			description: 'Decides what the library expects to be able to reach.',
			icon: 'i-lucide-database',
			condition: reading.condition.catalogue,
		},
		{
			label: 'Canonical byte store',
			description: 'Decides which validated bytes exist right now.',
			icon: 'i-lucide-archive',
			condition: reading.condition.canonicalByteStore,
		},
		{
			label: 'Staging byte store',
			description: 'Holds provisional transfers and multipart upload state.',
			icon: 'i-lucide-package-open',
			condition: reading.condition.stagingByteStore,
		},
	];
});

function conditionLabel(condition: GraphicsLibraryComponentCondition) {
	return condition.status === 'healthy'
		? 'Healthy'
		: condition.status === 'degraded'
			? 'Degraded'
			: 'Unavailable';
}

function conditionColor(condition: GraphicsLibraryComponentCondition) {
	return condition.status === 'healthy'
		? 'success'
		: condition.status === 'degraded'
			? 'warning'
			: 'error';
}

function conditionReason(condition: GraphicsLibraryComponentCondition) {
	if (condition.status === 'healthy')
		return 'Answering, with nothing outstanding.';
	if (condition.status === 'unavailable') {
		return condition.reason.code === 'catalogue-unavailable'
			? 'The catalogue could not answer. This is retryable.'
			: 'The byte store could not answer. This is retryable.';
	}
	return condition.reason.code === 'catalogue-records-unavailable-content'
		? `Answering, and recording ${condition.reason.openCount} `
		+ 'Graphic Asset Contents it cannot currently serve.'
		: `Answering, and disagreeing with the catalogue on ${condition.reason.openCount} `
			+ 'subjects.';
}

const ALERT_SUMMARIES: Record<GraphicsStorageHealthAlert['code'], string> = {
	'catalogue-unavailable': 'The D1 catalogue cannot answer',
	'canonical-byte-store-unavailable': 'The canonical byte store cannot answer',
	'staging-byte-store-unavailable': 'The staging byte store cannot answer',
	'critical-integrity-incident-open': 'Critical integrity incidents are open and fail closed',
	'unavailable-content-open': 'Unavailable Graphic Asset Content is open',
	'missing-derivative-open': 'Graphics Derivatives are missing and can be regenerated',
	'unexpected-object-quarantined': 'Unexpected objects are held in Content Quarantine',
	'canonical-quota-full': 'The Canonical Graphics Quota is full; net-new publication is blocked',
	'canonical-quota-critical': 'The Canonical Graphics Quota has passed 95%',
	'canonical-quota-warning': 'The Canonical Graphics Quota has passed 80%',
	'staging-allowance-exhausted': 'The Graphics Staging Allowance has no room left',
	'graphics-ingestion-input-expired': 'Staged input passed its retention guarantee',
};

function alertColor(severity: GraphicsStorageHealthAlertSeverity) {
	return severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info';
}

const ATTENTION_LABELS: Record<GraphicsIngestionAttentionItem['attention'], string> = {
	'input-expired': 'Input expired',
	'retryable': 'Retryable',
	'awaiting-confirmation': 'Awaiting confirmation',
	'active': 'Active',
};

const OUTCOME_GROUP_LABELS: Record<GraphicsRecentOutcomeGroup, string> = {
	'unavailable-content': 'Unavailable Content',
	'missing-derivative': 'Missing derivatives',
	'quarantined-object': 'Quarantined objects',
	'integrity-incident': 'Integrity incidents',
	'resolved-repair': 'Resolved repairs',
	'rejected-repair': 'Rejected repairs',
};

function formatInstant(instant: string | undefined) {
	return instant ? new Date(instant).toLocaleString() : 'None';
}

function formatGuarantee(milliseconds: number) {
	return `${Math.round(milliseconds / MILLISECONDS_PER_DAY)} days`;
}

function boundaryOffset(fraction: number) {
	return `${Math.min(fraction, 1) * 100}%`;
}

/**
 * The 100% marker sits exactly on the track's right edge, where a marker drawn
 * from its left edge would fall outside the rounded track and disappear. Pulling
 * the final marker back by its own width keeps it visible and still on the line.
 */
function boundaryMarkerStyle(fraction: number) {
	return fraction >= 1
		? { right: '0px' }
		: { left: boundaryOffset(fraction) };
}
</script>

<template>
	<NuxtLayout name="default">
		<template #actions>
			<UButton
				color="neutral"
				variant="outline"
				icon="i-lucide-list-checks"
				to="/admin/graphics-assets/queues"
				label="Open lifecycle queues"
			/>
			<UButton
				color="neutral"
				variant="outline"
				icon="i-lucide-refresh-cw"
				:loading="loadPending"
				:disabled="!hasReading"
				@click="loadCockpit"
			>
				Refresh
			</UButton>
		</template>

		<div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
			<div>
				<h1 class="text-2xl font-semibold text-highlighted">
					Graphics Asset Library Operations
				</h1>
				<p class="mt-1 text-sm text-muted">
					Whether the library is safe, and what currently needs attention.
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
						description="The cockpit is administrator-only. The token is held for this session only and never stored."
					>
						<UInput
							v-model="administratorToken"
							type="password"
							autocomplete="current-password"
						/>
					</UFormField>
					<div>
						<UButton
							label="Open cockpit"
							icon="i-lucide-gauge"
							:loading="loadPending"
							@click="loadCockpit"
						/>
					</div>
					<p v-if="loadError" class="text-sm text-error">
						{{ loadError }}
					</p>
				</div>
			</UCard>

			<template v-if="cockpit">
				<UAlert
					v-if="loadError"
					color="error"
					variant="soft"
					icon="i-lucide-triangle-alert"
					title="The last reading failed"
					:description="loadError"
				/>

				<!-- Health first: the separate answers, before anything else. -->
				<section class="flex flex-col gap-3">
					<div class="flex items-center gap-3">
						<h2 class="text-lg font-semibold text-highlighted">
							Library condition
						</h2>
						<UBadge
							:color="cockpit.condition.status === 'healthy'
								? 'success'
								: cockpit.condition.status === 'degraded' ? 'warning' : 'error'"
							variant="soft"
							:label="cockpit.condition.status === 'healthy'
								? 'Healthy'
								: cockpit.condition.status === 'degraded' ? 'Degraded' : 'Unavailable'"
						/>
					</div>
					<div class="grid gap-4 md:grid-cols-3">
						<UCard v-for="result in conditions" :key="result.label">
							<div class="flex items-start justify-between gap-4">
								<div class="flex items-start gap-3">
									<div class="rounded-lg bg-elevated p-2 text-muted">
										<UIcon :name="result.icon" class="size-5" />
									</div>
									<div>
										<h3 class="font-medium text-highlighted">
											{{ result.label }}
										</h3>
										<p class="mt-1 text-sm text-muted">
											{{ result.description }}
										</p>
									</div>
								</div>
								<UBadge
									:color="conditionColor(result.condition)"
									variant="soft"
									:label="conditionLabel(result.condition)"
								/>
							</div>
							<p class="mt-3 text-sm text-toned">
								{{ conditionReason(result.condition) }}
							</p>
						</UCard>
					</div>
				</section>

				<section class="flex flex-col gap-3">
					<div class="flex flex-wrap items-center gap-3">
						<h2 class="text-lg font-semibold text-highlighted">
							Open alerts
						</h2>
						<UBadge
							variant="soft"
							color="error"
							:label="`${cockpit.alerts.countsBySeverity.critical} critical`"
						/>
						<UBadge
							variant="soft"
							color="warning"
							:label="`${cockpit.alerts.countsBySeverity.warning} warning`"
						/>
						<UBadge
							variant="soft"
							color="info"
							:label="`${cockpit.alerts.countsBySeverity.info} info`"
						/>
					</div>
					<p v-if="cockpit.alerts.open.length === 0" class="text-sm text-muted">
						No storage-health alerts are open.
					</p>
					<UAlert
						v-for="alert in cockpit.alerts.open"
						:key="alert.code"
						:color="alertColor(alert.severity)"
						variant="soft"
						icon="i-lucide-triangle-alert"
					>
						<div class="flex flex-wrap items-center gap-2">
							<span>{{ ALERT_SUMMARIES[alert.code] }} ({{ alert.openCount }})</span>
							<UBadge
								v-if="alert.persistent"
								variant="subtle"
								color="neutral"
								label="Persistent"
							/>
						</div>
					</UAlert>
				</section>

				<template v-if="cockpit.outcome === 'catalogue-unavailable'">
					<UAlert
						color="error"
						variant="soft"
						icon="i-lucide-database-backup"
						title="Catalogue state is unavailable"
						description="Capacity, ingestion, reconciliation backlog, lifecycle deadlines, and recent outcomes all come from the catalogue, so none of them can be reported until it answers again. This is retryable."
					/>
				</template>

				<template v-else>
					<section class="grid gap-4 lg:grid-cols-2">
						<UCard>
							<template #header>
								<div class="flex items-center justify-between gap-4">
									<h2 class="font-semibold text-highlighted">
										Canonical Graphics Quota
									</h2>
									<UBadge :label="cockpit.capacity.canonical.pressure" variant="soft" />
								</div>
							</template>

							<div
								class="relative h-3 w-full overflow-hidden rounded-full bg-elevated"
								role="progressbar"
								aria-label="Canonical Graphics Quota used"
								:aria-valuemin="0"
								:aria-valuemax="cockpit.capacity.canonical.limitBytes"
								:aria-valuenow="cockpit.capacity.canonical.usedBytes"
								:aria-valuetext="`${formatByteCount(cockpit.capacity.canonical.usedBytes)} of ${formatByteCount(cockpit.capacity.canonical.limitBytes)} used, ${cockpit.capacity.canonical.pressure} pressure`"
							>
								<div
									class="absolute inset-y-0 left-0 rounded-full bg-primary"
									:style="{ width: boundaryOffset(cockpit.capacity.canonical.usedFraction) }"
								/>
								<div
									v-for="boundary in [
										{ label: '80%', fraction: cockpit.capacity.canonical.boundaries.warningFraction },
										{ label: '95%', fraction: cockpit.capacity.canonical.boundaries.criticalFraction },
										{ label: '100%', fraction: cockpit.capacity.canonical.boundaries.fullFraction },
									]"
									:key="boundary.label"
									class="absolute inset-y-0 w-px bg-inverted"
									:style="boundaryMarkerStyle(boundary.fraction)"
								/>
							</div>
							<dl class="mt-3 grid grid-cols-3 gap-3 text-sm">
								<div>
									<dt class="text-xs text-dimmed">
										Warning at 80%
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(cockpit.capacity.canonical.boundaries.warningBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Critical at 95%
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(cockpit.capacity.canonical.boundaries.criticalBytes) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Blocked at 100%
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(cockpit.capacity.canonical.boundaries.fullBytes) }}
									</dd>
								</div>
							</dl>
							<p class="mt-3 text-sm text-muted">
								{{ formatByteCount(cockpit.capacity.canonical.usedBytes) }} used ·
								{{ formatByteCount(cockpit.capacity.canonical.reservedBytes) }} reserved ·
								{{ formatByteCount(cockpit.capacity.canonical.availableBytes) }} available
							</p>
						</UCard>

						<UCard>
							<template #header>
								<h2 class="font-semibold text-highlighted">
									Graphics Staging Allowance
								</h2>
							</template>
							<p class="text-sm text-muted">
								A separate budget for provisional transfers. It is never borrowed from
								or lent to the Canonical Graphics Quota, and carries no canonical
								boundary of its own.
							</p>
							<p class="mt-3 text-sm text-muted">
								{{ formatByteCount(cockpit.capacity.staging.usedBytes) }} verified ·
								{{ formatByteCount(cockpit.capacity.staging.reservedBytes) }} reserved ·
								{{ formatByteCount(cockpit.capacity.staging.limitBytes) }} limit
							</p>
							<UButton
								class="mt-4"
								color="neutral"
								variant="outline"
								icon="i-lucide-sliders-horizontal"
								to="/admin/graphics-assets/health"
								label="Change capacity limits"
							/>
						</UCard>
					</section>

					<section class="flex flex-col gap-3">
						<h2 class="text-lg font-semibold text-highlighted">
							Graphics Ingestion Operations
						</h2>
						<div class="flex flex-wrap gap-2">
							<UBadge
								v-for="state in GRAPHICS_INGESTION_ATTENTION_STATES"
								:key="state"
								variant="soft"
								:color="state === 'input-expired'
									? 'warning'
									: state === 'retryable' ? 'warning' : 'neutral'"
								:label="`${ATTENTION_LABELS[state]}: ${cockpit.ingestion.counts[state]}`"
							/>
						</div>
						<p v-if="cockpit.ingestion.operations.length === 0" class="text-sm text-muted">
							No Graphics Ingestion Operation is waiting on anything.
						</p>
						<UCard v-for="item in cockpit.ingestion.operations" :key="item.operationId">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div>
									<h3 class="font-medium text-highlighted">
										{{ item.name }}
									</h3>
									<p class="mt-1 text-sm text-muted">
										{{ item.source }} · started by {{ item.initiatedBy }} ·
										stage {{ item.stage }}
									</p>
								</div>
								<UBadge variant="soft" :label="ATTENTION_LABELS[item.attention]" />
							</div>
							<dl class="mt-3 grid gap-3 text-sm sm:grid-cols-3">
								<div>
									<dt class="text-xs text-dimmed">
										Transferred
									</dt>
									<dd class="text-muted">
										{{ formatByteCount(item.transferredByteLength) }} of
										{{ formatByteCount(item.declaredByteLength) }}
										{{ item.transferComplete ? '(complete)' : '(in progress)' }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Staged input expires
									</dt>
									<dd class="text-muted">
										{{ formatInstant(item.inputExpiresAt) }}
									</dd>
								</div>
								<div v-if="item.failureCode">
									<dt class="text-xs text-dimmed">
										Failure
									</dt>
									<dd class="text-muted">
										{{ item.failureCode }}
									</dd>
								</div>
							</dl>
						</UCard>
					</section>

					<section class="grid gap-4 lg:grid-cols-2">
						<UCard>
							<template #header>
								<h2 class="font-semibold text-highlighted">
									Reconciliation backlog
								</h2>
							</template>
							<div class="flex flex-wrap gap-2">
								<UBadge
									variant="soft"
									color="error"
									:label="`${cockpit.reconciliation.countsBySeverity.critical} critical`"
								/>
								<UBadge
									variant="soft"
									color="warning"
									:label="`${cockpit.reconciliation.countsBySeverity.warning} warning`"
								/>
								<UBadge
									variant="soft"
									color="info"
									:label="`${cockpit.reconciliation.countsBySeverity.info} info`"
								/>
							</div>
							<dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
								<div v-for="(count, kind) in cockpit.reconciliation.openCounts" :key="kind">
									<dt class="text-xs text-dimmed">
										{{ kind }}
									</dt>
									<dd class="text-muted">
										{{ count }}
									</dd>
								</div>
							</dl>
							<p class="mt-3 text-sm text-muted">
								{{ cockpit.reconciliation.isolatedIncidentCount }} isolated incidents fail
								closed and are never repaired in place.
							</p>
							<p class="mt-2 text-xs text-dimmed">
								The catalogue decides expected reachability; the byte store decides which
								bytes are present. The availability flag is advisory reconciliation state.
							</p>
							<p v-if="cockpit.reconciliation.lastSweep" class="mt-2 text-xs text-dimmed">
								Last sweep completed
								{{ formatInstant(cockpit.reconciliation.lastSweep.completedAt) }}
							</p>
						</UCard>

						<UCard>
							<template #header>
								<h2 class="font-semibold text-highlighted">
									Recovery and cleanup deadlines
								</h2>
							</template>
							<dl class="grid gap-3 text-sm sm:grid-cols-2">
								<div>
									<dt class="text-xs text-dimmed">
										Retired
									</dt>
									<dd class="text-muted">
										{{ cockpit.lifecycle.retired.count }} · reversible, no deadline
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Trashed
									</dt>
									<dd class="text-muted">
										{{ cockpit.lifecycle.trashed.count }} ·
										{{ formatGuarantee(cockpit.lifecycle.trashed.guaranteeMilliseconds) }}
										recovery · next
										{{ formatInstant(cockpit.lifecycle.trashed.nextDeadline) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Superseded revisions
									</dt>
									<dd class="text-muted">
										{{ cockpit.lifecycle.supersededRevisions.count }} ·
										{{ formatGuarantee(
											cockpit.lifecycle.supersededRevisions.guaranteeMilliseconds,
										) }}
										recovery · next
										{{ formatInstant(cockpit.lifecycle.supersededRevisions.nextDeadline) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Frozen by Trash
									</dt>
									<dd class="text-muted">
										{{ cockpit.lifecycle.frozenRevisions.count }} revisions
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Quarantined content
									</dt>
									<dd class="text-muted">
										{{ cockpit.lifecycle.quarantinedContent.count }} · next
										{{ formatInstant(cockpit.lifecycle.quarantinedContent.nextDeadline) }}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-dimmed">
										Staged input
									</dt>
									<dd class="text-muted">
										{{ cockpit.lifecycle.stagedInput.count }} · next
										{{ formatInstant(cockpit.lifecycle.stagedInput.nextDeadline) }}
									</dd>
								</div>
							</dl>
							<p class="mt-3 text-sm text-muted">
								Storage pressure never shortens any of these guarantees.
							</p>
						</UCard>
					</section>

					<section class="flex flex-col gap-3">
						<h2 class="text-lg font-semibold text-highlighted">
							Recent outcomes
						</h2>
						<div class="flex flex-wrap gap-2">
							<UBadge
								v-for="group in GRAPHICS_RECENT_OUTCOME_GROUPS"
								:key="group"
								variant="soft"
								:label="`${OUTCOME_GROUP_LABELS[group]}: ${cockpit.recentOutcomes.countsByGroup[group]}`"
							/>
						</div>
						<p v-if="cockpit.recentOutcomes.entries.length === 0" class="text-sm text-muted">
							No recent automated outcomes.
						</p>
						<ul v-else class="flex flex-col gap-2">
							<li
								v-for="entry in cockpit.recentOutcomes.entries"
								:key="entry.id"
								class="rounded-lg border border-muted p-3 text-sm"
							>
								<span class="text-highlighted">{{ OUTCOME_GROUP_LABELS[entry.group] }}</span>
								<span class="text-muted"> · {{ entry.outcome }} · {{ entry.reason }}</span>
								<span class="block text-xs text-dimmed">
									{{ entry.subject.kind }} · {{ formatInstant(entry.recordedAt) }}
								</span>
							</li>
						</ul>
					</section>

					<section class="flex flex-col gap-3">
						<h2 class="text-lg font-semibold text-highlighted">
							Actions
						</h2>
						<p class="text-sm text-muted">
							Both sweeps are safe to run at any time. Neither can shorten a recovery
							guarantee.
						</p>
						<div class="flex flex-wrap gap-3">
							<UButton
								color="neutral"
								variant="outline"
								icon="i-lucide-scan-search"
								:loading="sweepPending === 'reconciliation'"
								@click="runSweep('reconciliation')"
							>
								Run reconciliation now
							</UButton>
							<UButton
								color="neutral"
								variant="outline"
								icon="i-lucide-brush-cleaning"
								:loading="sweepPending === 'retention'"
								@click="runSweep('retention')"
							>
								Run retention sweep now
							</UButton>
						</div>
						<p v-if="sweepSummary" class="text-sm text-success">
							{{ sweepSummary }}
						</p>
						<p v-if="sweepError" class="text-sm text-error">
							{{ sweepError }}
						</p>
					</section>
				</template>

				<p class="text-xs text-dimmed">
					Last read {{ formatInstant(cockpit.checkedAt) }}
				</p>
			</template>
		</div>
	</NuxtLayout>
</template>
