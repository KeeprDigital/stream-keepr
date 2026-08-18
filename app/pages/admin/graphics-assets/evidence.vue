<script setup lang="ts">
import type {
	GraphicsAssetEvidenceEntry,
	GraphicsAssetEvidencePosition,
	GraphicsAssetEvidenceReading,
	GraphicsAssetEvidenceSubjectKind,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsEvidenceCategoryGroup } from '~~/shared/utils/graphicsAssetEvidence';
import { formatByteCount } from '~~/shared/utils/formatByteCount';
import { formatInstant } from '~~/shared/utils/formatInstant';
import {
	GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES,
	graphicsActorName,
	graphicsEvidenceQueueFor,
} from '~~/shared/utils/graphicsAssetEvidence';

definePageMeta({
	title: 'Graphics Evidence',
});

/**
 * The chronological Evidence ledger.
 *
 * The ledger only grows, so this page never asks for all of it: it reads one
 * bounded page at a time and moves by the entry it stopped on. Filters and
 * position are held here rather than in the address because a ledger position
 * is a moment in a record that is still being written — a shared link to page
 * four would point somewhere different tomorrow, while a filter shared as a
 * subject or a correlation identity still means the same thing.
 */

/** How many entries one page shows. */
const PAGE_LIMIT = 25;

const SUBJECT_KINDS: GraphicsAssetEvidenceSubjectKind[] = [
	'graphics-ingestion-operation',
	'graphic-asset',
	'graphic-asset-revision',
	'graphic-asset-content',
	'graphics-derivative',
	'graphics-discrepancy',
];

const GROUP_LABELS: Record<GraphicsEvidenceCategoryGroup, string> = {
	ingestion: 'Ingestion',
	lifecycle: 'Lifecycle',
	pruning: 'Pruning',
	purge: 'Purge',
	quarantine: 'Quarantine',
	reconciliation: 'Reconciliation',
	repair: 'Repair',
	regeneration: 'Regeneration',
	restoration: 'Restoration',
};

interface EvidenceFilters {
	groups: GraphicsEvidenceCategoryGroup[];
	subjectKind: GraphicsAssetEvidenceSubjectKind | '';
	subjectId: string;
	actor: string;
	correlationId: string;
	recordedFrom: string;
	recordedUntil: string;
}

function noFilters(): EvidenceFilters {
	return {
		groups: [],
		subjectKind: '',
		subjectId: '',
		actor: '',
		correlationId: '',
		recordedFrom: '',
		recordedUntil: '',
	};
}

/**
 * The filter form, and separately the question it was last used to ask.
 *
 * Only Apply moves one into the other. The reading is refreshed on a timer, so
 * a form bound straight to the query would submit half a typed identity on
 * whichever keystroke a tick landed between — and an audit surface answering
 * "no Evidence matches" mid-word invites exactly the wrong conclusion. Worse,
 * a tick would carry the changed filter while keeping the position from the
 * previous question, which is the one thing the position must never do.
 */
const draft = ref<EvidenceFilters>(noFilters());
const applied = ref<EvidenceFilters>(noFilters());

/**
 * Where in the ledger this page is. It belongs to the applied question rather
 * than to the form: a position within the answer to one question means nothing
 * to another, so asking again always starts at the newest end.
 */
const cursor = ref<GraphicsAssetEvidencePosition | null>(null);
const direction = ref<'older' | 'newer'>('older');

/** A local datetime from the form as the instant the ledger stores. */
function instantFrom(local: string) {
	if (!local)
		return undefined;
	const parsed = new Date(local);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function evidenceQuery() {
	const question = applied.value;
	return {
		limit: PAGE_LIMIT,
		...(question.groups.length > 0 ? { group: question.groups } : {}),
		...(question.subjectKind && question.subjectId.trim()
			? { subjectKind: question.subjectKind, subjectId: question.subjectId.trim() }
			: {}),
		...(question.actor.trim() ? { actor: question.actor.trim() } : {}),
		...(question.correlationId.trim() ? { correlationId: question.correlationId.trim() } : {}),
		...(instantFrom(question.recordedFrom)
			? { recordedFrom: instantFrom(question.recordedFrom) }
			: {}),
		...(instantFrom(question.recordedUntil)
			? { recordedUntil: instantFrom(question.recordedUntil) }
			: {}),
		...(cursor.value
			? {
					cursorRecordedAt: cursor.value.recordedAt,
					cursorId: cursor.value.id,
					direction: direction.value,
				}
			: {}),
	};
}

const {
	administratorToken,
	reading: ledger,
	loadPending,
	loadError,
	hasReading,
	load: loadLedger,
} = useGraphicsAdminReading<GraphicsAssetEvidenceReading>({
	read: async headers => await $fetch<GraphicsAssetEvidenceReading>(
		'/api/admin/graphics-assets/evidence',
		{ headers, query: evidenceQuery() },
	),
	failureMessage: 'The Evidence ledger could not be read.',
});

/**
 * Submits the form as the new question. It is a new question, so it is asked
 * from the newest end rather than from wherever the previous answer was paged.
 */
async function applyFilters() {
	applied.value = { ...draft.value, groups: [...draft.value.groups] };
	cursor.value = null;
	direction.value = 'older';
	await loadLedger();
}

async function clearFilters() {
	draft.value = noFilters();
	await applyFilters();
}

async function turnTo(position: GraphicsAssetEvidencePosition, towards: 'older' | 'newer') {
	cursor.value = position;
	direction.value = towards;
	await loadLedger();
}

/**
 * A form holding nothing but the one thread being followed.
 *
 * The thread is assigned onto a fresh reset rather than written as overrides
 * beside a spread of one. The two say the same thing, and the spread said it
 * more plainly — but a spread and the keys overriding it flatten into a single
 * object literal when the page is bundled, and the four keys the callers below
 * override were four of the five `duplicate-object-key` warnings every Worker
 * build printed. Last-key-wins meant the overrides were always the ones that
 * survived, so nothing here was ever wrong; the cost was four standing warnings,
 * and a standing warning is where a real shadowing goes unread (#324).
 */
function threadOnly(thread: Partial<EvidenceFilters>): EvidenceFilters {
	return Object.assign(noFilters(), thread);
}

/**
 * The three ways one entry leads to another: everything that happened to the
 * same subject, everything one sweep or request decided, and everyone one actor
 * decided. Each replaces the filter rather than adding to it, because following
 * a thread is a new question and not a narrowing of the old one.
 */
async function followSubject(entry: GraphicsAssetEvidenceEntry) {
	draft.value = threadOnly({ subjectKind: entry.subject.kind, subjectId: entry.subject.id });
	await applyFilters();
}

async function followCorrelation(entry: GraphicsAssetEvidenceEntry) {
	draft.value = threadOnly({ correlationId: entry.correlationId });
	await applyFilters();
}

async function followActor(entry: GraphicsAssetEvidenceEntry) {
	draft.value = threadOnly({ actor: entry.actor });
	await applyFilters();
}

/**
 * Where an entry's subject is still being worked, or nothing when the subject
 * is gone. A terminal entry is the record of an absence, and offering to
 * inspect the absence would only ever answer 404.
 */
function inspectorLink(entry: GraphicsAssetEvidenceEntry) {
	const queue = graphicsEvidenceQueueFor(entry.category);
	return queue
		? {
				path: '/admin/graphics-assets/queues',
				query: { queue, item: entry.subject.id },
			}
		: null;
}

/**
 * The measured facts an entry carries, as label and value pairs, so a detail
 * that was never recorded is simply absent rather than shown as a zero it did
 * not observe.
 */
function measurements(entry: GraphicsAssetEvidenceEntry) {
	const { detail } = entry;
	return [
		detail.transition
			? { label: 'Transition', value: `${detail.transition.from} → ${detail.transition.to}` }
			: null,
		detail.referenceCount === undefined
			? null
			: { label: 'References checked', value: `${detail.referenceCount}` },
		detail.revisionCount === undefined
			? null
			: { label: 'Revisions', value: `${detail.revisionCount}` },
		detail.bytesFreed === undefined
			? null
			: { label: 'Bytes freed', value: formatByteCount(detail.bytesFreed) },
		detail.bytesReserved === undefined
			? null
			: { label: 'Bytes reserved', value: formatByteCount(detail.bytesReserved) },
		detail.deadline ? { label: 'Deadline', value: formatInstant(detail.deadline) } : null,
		detail.canonicalPressure
			? {
					label: 'Quota at the time',
					value: `${detail.canonicalPressure}${
						detail.canonicalUsedBytes === undefined
							? ''
							: ` · ${formatByteCount(detail.canonicalUsedBytes)} used`
					}${
						detail.canonicalLimitBytes === undefined
							? ''
							: ` of ${formatByteCount(detail.canonicalLimitBytes)}`
					}`,
				}
			: null,
		detail.operationId ? { label: 'Operation', value: detail.operationId } : null,
		detail.discrepancyKind
			? { label: 'Disagreement', value: detail.discrepancyKind }
			: null,
		detail.reasonCode ? { label: 'Reason code', value: detail.reasonCode } : null,
		detail.rejectionCode ? { label: 'Refused because', value: detail.rejectionCode } : null,
		detail.affectedRevisionCount === undefined
			? null
			: { label: 'Revisions affected', value: `${detail.affectedRevisionCount}` },
	].filter(measurement => measurement !== null);
}

/** Whether the ledger on screen is an answer to a narrowed question. */
const filtered = computed(() =>
	applied.value.groups.length > 0
	|| Boolean(applied.value.subjectId.trim())
	|| Boolean(applied.value.actor.trim())
	|| Boolean(applied.value.correlationId.trim())
	|| Boolean(applied.value.recordedFrom)
	|| Boolean(applied.value.recordedUntil));
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
				@click="loadLedger"
			>
				Refresh
			</UButton>
		</template>

		<div class="mx-auto flex w-full max-w-7xl flex-col gap-6">
			<div>
				<h1 class="text-2xl font-semibold text-highlighted">
					Graphics Evidence ledger
				</h1>
				<p class="mt-1 text-sm text-muted">
					Every durable lifecycle, reconciliation, and reclamation decision, newest first.
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
						description="The Evidence ledger is administrator-only. The token is held for this session only and never stored."
					>
						<UInput
							v-model="administratorToken"
							type="password"
							autocomplete="current-password"
						/>
					</UFormField>
					<div>
						<UButton
							label="Open the ledger"
							icon="i-lucide-scroll-text"
							:loading="loadPending"
							@click="loadLedger"
						/>
					</div>
					<p v-if="loadError" class="text-sm text-error">
						{{ loadError }}
					</p>
				</div>
			</UCard>

			<template v-if="ledger">
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
					icon="i-lucide-shield-check"
					title="What this ledger holds"
					description="Subjects are opaque domain identities. No filename, object key, digest, delivery URL, capability secret, or deleted byte is ever recorded here. Evidence is kept for one year after its subject's final purge or terminal cleanup."
				/>

				<UCard>
					<template #header>
						<h2 class="font-semibold text-highlighted">
							Narrow the ledger
						</h2>
					</template>
					<div class="flex flex-col gap-4">
						<UFormField
							label="What kind of decision"
							description="Leave empty to see every category."
						>
							<div class="flex flex-wrap gap-2">
								<UButton
									v-for="group in GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES"
									:key="group"
									size="xs"
									:color="draft.groups.includes(group) ? 'primary' : 'neutral'"
									:variant="draft.groups.includes(group) ? 'solid' : 'outline'"
									:label="GROUP_LABELS[group]"
									@click="draft.groups = draft.groups.includes(group)
										? draft.groups.filter(selected => selected !== group)
										: [...draft.groups, group]"
								/>
							</div>
						</UFormField>

						<div class="grid gap-4 sm:grid-cols-2">
							<UFormField label="Subject kind">
								<USelect
									v-model="draft.subjectKind"
									:items="[{ label: 'Any', value: '' },
										...SUBJECT_KINDS.map(kind => ({ label: kind, value: kind }))]"
								/>
							</UFormField>
							<UFormField
								label="Subject identity"
								description="Both halves are needed; a kind alone would widen the question."
							>
								<UInput v-model="draft.subjectId" placeholder="Opaque domain identity" />
							</UFormField>
							<UFormField label="Actor or policy">
								<UInput v-model="draft.actor" placeholder="graphics-retention-policy" />
							</UFormField>
							<UFormField
								label="Operation or correlation identity"
								description="Everything one sweep or one request decided."
							>
								<UInput v-model="draft.correlationId" placeholder="Opaque identity" />
							</UFormField>
							<UFormField label="Recorded from">
								<UInput v-model="draft.recordedFrom" type="datetime-local" />
							</UFormField>
							<UFormField label="Recorded until">
								<UInput v-model="draft.recordedUntil" type="datetime-local" />
							</UFormField>
						</div>

						<div class="flex flex-wrap gap-2">
							<UButton
								label="Apply"
								icon="i-lucide-filter"
								:loading="loadPending"
								@click="applyFilters"
							/>
							<UButton
								v-if="filtered"
								color="neutral"
								variant="outline"
								label="Clear filters"
								icon="i-lucide-filter-x"
								@click="clearFilters"
							/>
						</div>
					</div>
				</UCard>

				<!--
					A tombstone answers the question an empty ledger cannot: whether
					this identity was purged or never existed at all.
				-->
				<UAlert
					v-if="ledger.tombstone"
					color="warning"
					variant="soft"
					icon="i-lucide-square-asterisk"
					title="This Graphic Asset was purged"
					:description="`Purged ${formatInstant(ledger.tombstone.purgedAt)} · ${ledger.tombstone.reason} · `
						+ `${ledger.tombstone.revisionCount} revisions removed against `
						+ `${ledger.tombstone.referenceCount} references. The tombstone outlives this Evidence and `
						+ `explains later provenance questions, but it satisfies no Graphic Asset Reference and the `
						+ `identity is never reused.`"
				/>

				<UCard>
					<template #header>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h2 class="font-semibold text-highlighted">
								Evidence
							</h2>
							<UBadge
								variant="subtle"
								color="neutral"
								:label="`${ledger.entries.length} shown`"
							/>
						</div>
					</template>

					<p v-if="ledger.entries.length === 0" class="text-sm text-muted">
						{{ filtered
							? 'No Evidence matches that question.'
							: 'The Evidence ledger holds nothing yet.' }}
					</p>

					<ol v-else class="flex flex-col gap-3">
						<li
							v-for="entry in ledger.entries"
							:key="entry.id"
							class="rounded-lg border border-muted p-3"
						>
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<span class="font-medium text-highlighted">{{ entry.category }}</span>
								<span class="text-xs text-dimmed">{{ formatInstant(entry.recordedAt) }}</span>
							</div>
							<p class="text-sm text-muted">
								{{ entry.outcome }} · {{ entry.reason }}
							</p>
							<p class="text-xs text-dimmed">
								{{ graphicsActorName(ledger.actorNames, entry.actor) }} · {{ entry.subject.kind }} {{ entry.subject.id }}
							</p>

							<dl
								v-if="measurements(entry).length > 0"
								class="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2"
							>
								<div
									v-for="measurement in measurements(entry)"
									:key="measurement.label"
									class="flex justify-between gap-2"
								>
									<dt class="text-dimmed">
										{{ measurement.label }}
									</dt>
									<dd class="text-muted">
										{{ measurement.value }}
									</dd>
								</div>
							</dl>

							<p class="mt-2 text-xs text-dimmed">
								Retained until {{ entry.expiresAt
									? formatInstant(entry.expiresAt)
									: 'its subject is cleaned up' }}
							</p>

							<div class="mt-2 flex flex-wrap gap-2">
								<UButton
									size="xs"
									color="neutral"
									variant="outline"
									icon="i-lucide-link"
									label="This subject"
									@click="followSubject(entry)"
								/>
								<UButton
									size="xs"
									color="neutral"
									variant="outline"
									icon="i-lucide-git-branch"
									label="Same operation"
									@click="followCorrelation(entry)"
								/>
								<UButton
									size="xs"
									color="neutral"
									variant="outline"
									icon="i-lucide-user-round"
									label="Same actor"
									@click="followActor(entry)"
								/>
								<UButton
									v-if="inspectorLink(entry)"
									size="xs"
									color="neutral"
									variant="outline"
									icon="i-lucide-list-checks"
									label="Inspect in queues"
									:to="inspectorLink(entry)!"
								/>
							</div>
						</li>
					</ol>

					<template #footer>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<UButton
								color="neutral"
								variant="outline"
								icon="i-lucide-chevron-up"
								label="Newer"
								:disabled="!ledger.newer || loadPending"
								@click="ledger.newer && turnTo(ledger.newer, 'newer')"
							/>
							<span class="text-xs text-dimmed">
								Positioned by the entry this page ended on, so a sweep writing
								Evidence while these pages are turned never shifts them.
							</span>
							<UButton
								color="neutral"
								variant="outline"
								icon="i-lucide-chevron-down"
								label="Older"
								:disabled="!ledger.older || loadPending"
								@click="ledger.older && turnTo(ledger.older, 'older')"
							/>
						</div>
					</template>
				</UCard>
			</template>
		</div>
	</NuxtLayout>
</template>
