<script setup lang="ts">
import type { GraphicInputTrace } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicConfig,
	GraphicInputValue,
	GraphicPlayoutState,
} from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import {
	graphicInputTextValue,
	isOperatorSelectedGraphicSource,
	resolveGraphicInputBindings,
} from '~~/shared/modules/graphics';

/**
 * Generated Live Control for one placed Broadcast Graphic.
 *
 * Every control here is generated from a declared Graphic Input: an operator
 * selects and edits declared values and can never author a binding, a custom
 * control, a query, or an expression. There is no authoring surface, which is why
 * this component reads the declarations and writes only values.
 *
 * ## The values, shown apart
 *
 * Each field shows its latest bound value, the value staged to go on air, and the
 * accepted on-air value, because an operator has to be able to trust what program
 * shows over what is staged. A value that violates its declared type or
 * constraints is shown as unavailable together with the reason and is never
 * silently corrected — the operator sees exactly what they entered.
 *
 * ## Bound fields are corrected, not typed over
 *
 * A field whose Graphic Input Binding resolves it edits a Graphic Input Override
 * rather than the manual working value: the binding decides the value, so typing
 * into the working value would change nothing an operator could see. The override
 * masks the binding, the bound value stays visible underneath it, and Clear resumes
 * whatever the binding resolves at that moment.
 *
 * ## Why the actions come and go
 *
 * Update Graphic is offered only while the graphic is on air. While it is off,
 * editing changes the working values its next Take accepts, so an Update Graphic
 * action would be an acceptance with nothing to accept onto — the glossary states
 * it is not shown, and this is where that is true in the browser.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphic: BroadcastGraphicConfig;
	playoutState: GraphicPlayoutState;
	/** Whether this Broadcast Graphic has an action in flight. */
	pending?: boolean;
	/**
	 * Whether this browser is out of touch with the authoritative order.
	 *
	 * Every control is withheld while it is, and nothing is queued: an edit made
	 * offline would arrive claiming a value it could not possibly have checked, which
	 * is exactly the silent overwrite the field-scoped conflict rule exists to stop.
	 */
	disconnected?: boolean;
}>();

const sessionStore = useBroadcastGraphicsLiveSessionStore();
const { dataSet, selectionOptions } = useGraphicBindingData();

/** Locally typed values, committed to the working value or override on change or blur. */
const drafts = ref<Record<string, GraphicInputValue>>({});

/** The Graphic Source Selections this graphic asks an operator to make. */
const pickers = computed(() =>
	(props.graphic.sources ?? []).filter(isOperatorSelectedGraphicSource),
);

function selectedSource(sourceKey: string): number | undefined {
	return sessionStore.sourceSelections(props.screen.id, props.graphic.id)[sourceKey];
}

/**
 * The latest values this graphic's bindings resolve, recomputed whenever Event Data
 * or the operator's selections move. The server resolves the same bindings when it
 * accepts; this is what an operator watches in the meantime.
 */
const boundValues = computed(() => resolveGraphicInputBindings(
	props.graphic,
	sessionStore.sourceSelections(props.screen.id, props.graphic.id),
	dataSet.value,
));

const traces = computed<GraphicInputTrace[]>(() =>
	sessionStore.inputTraces(props.screen.id, props.graphic, boundValues.value),
);

const isOnAir = computed(() => props.playoutState !== 'off' && props.playoutState !== 'waiting');

/**
 * Update Graphic has something to accept exactly when an edit is not yet on air *and*
 * could go on air.
 *
 * `pending` alone is true for an unavailable value too, since it only says the staged
 * value differs from the accepted one. Offering the action then would offer an
 * acceptance that provably accepts nothing.
 */
const hasStagedChanges = computed(() => traces.value.some(trace =>
	trace.pending && trace.effective.availability.available,
));

/**
 * The required Graphic Inputs that stop this Broadcast Graphic going on air.
 *
 * Shown before the operator presses Take rather than only as the refusal, so the
 * missing value is a thing to fix rather than a surprise on air.
 */
const blockingInputs = computed(() => traces.value.filter(trace => trace.blocksTake));

function draftValue(trace: GraphicInputTrace): GraphicInputValue {
	return fieldValue(trace);
}

function editDraft(key: string, value: GraphicInputValue) {
	drafts.value = { ...drafts.value, [key]: value };
}

/**
 * Write one value.
 *

 * A bound Graphic Input takes an override, an unbound one takes the working value.
 * Either way the server accepts it, which is what makes the edit visible to every
 * other session immediately rather than when its author chooses to share it.
 *
 * The edit carries the value this operator was editing away from — the value shown
 * in the field's own trace, which is what they were looking at. That is its Field
 * Ownership claim, and it is what lets the server merge this edit with a colleague's
 * edit to a different Graphic Input while refusing to let it silently overwrite a
 * colleague's edit to this one.
 *
 * That claim is the **effective** value, and this is the moment the previous comment
 * here anticipated: a Graphic Input Override and a resolved binding now do sit above
 * the working value, so the shown value is the resolved one and reading `working`
 * would make the claim describe something the operator never saw. `trace.effective`
 * is exactly what `fieldValue` puts in the control, for both kinds of input.
 */
function commit(key: string, value?: GraphicInputValue) {
	const next = value === undefined ? drafts.value[key] : value;
	if (next === undefined)
		return;

	const trace = traces.value.find(entry => entry.declaration.key === key);
	if (!trace || props.disconnected)
		return;

	if (trace.binding) {
		void sessionStore.setOverride(
			props.eventId,
			props.screen.id,
			props.graphic.id,
			key,
			next,
			trace.effective.value,
		);
	}
	else {
		void sessionStore.setInput(
			props.eventId,
			props.screen.id,
			props.graphic.id,
			key,
			next,
			trace.effective.value,
		);
	}
}

function commitNow(key: string, value: GraphicInputValue) {
	editDraft(key, value);
	commit(key, value);
}

/** Stop masking a binding, after which its current bound value resumes. */
function clearOverride(key: string) {
	// Drop the local draft too, so the field falls back to showing the bound value the
	// binding resumes rather than the override the operator just cleared.
	const { [key]: _cleared, ...rest } = drafts.value;
	drafts.value = rest;
	void sessionStore.setOverride(props.eventId, props.screen.id, props.graphic.id, key, null);
}

/**
 * One picker value as a selection id. Anything that is not a positive entity id —
 * including the empty value a cleared picker emits — is a clear rather than a
 * selection, so it never reaches the route as `NaN`.
 */
function selectionIdOf(value: unknown): number | null {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}

function selectSource(sourceKey: string, selectionId: number | null) {
	void sessionStore.selectSource(props.eventId, props.screen.id, props.graphic.id, sourceKey, selectionId);
}

function update(cut: boolean) {
	void sessionStore.updateGraphic(props.eventId, props.screen.id, props.graphic.id, cut);
}

function choiceOptions(trace: GraphicInputTrace) {
	return trace.declaration.type === 'choice'
		? trace.declaration.options.map(option => ({ label: option.label, value: option.value }))
		: [];
}

/** One value as an operator reads it, or the word for its absence. */
function displayValue(trace: GraphicInputTrace, value: GraphicInputValue): string {
	if (value === null || value === undefined)
		return '—';
	if (trace.declaration.type === 'toggle')
		return value ? 'On' : 'Off';
	if (trace.declaration.type === 'media')
		return typeof value === 'object' ? `${value.assetId}@${value.revisionId}` : '—';
	return graphicInputTextValue(trace.declaration, value) || String(value);
}

const STATUS_LABELS: Record<GraphicInputTrace['status'], string> = {
	manual: 'Manual',
	bound: 'Bound',
	overridden: 'Overridden',
	pending: 'Pending',
	unavailable: 'Unavailable',
	superseded: 'Refreshed',
	stale: 'Stale',
};

const STATUS_COLORS: Record<GraphicInputTrace['status'], 'error' | 'warning' | 'neutral' | 'info'> = {
	manual: 'neutral',
	bound: 'neutral',
	overridden: 'info',
	pending: 'warning',
	unavailable: 'error',
	superseded: 'warning',
	stale: 'warning',
};

/**
 * The Graphic Inputs whose last edit from this session was refused because another
 * operator had already changed them.
 *
 * Named to the operator as what happened rather than as a status word: their edit
 * did not land, the field now shows the value that did, and the fix is to look and
 * decide again rather than to retry blindly.
 */
const refreshedInputs = computed(() => traces.value.filter(trace => trace.status === 'superseded'));

/** The value a field starts from: its override while one masks, otherwise what is staged. */
function fieldValue(trace: GraphicInputTrace): GraphicInputValue {
	if (trace.declaration.key in drafts.value)
		return drafts.value[trace.declaration.key]!;
	return trace.effective.value;
}

// A new selection starts from the authoritative working values rather than from
// whatever the previously selected graphic had typed into it.
watch(() => props.graphic.id, () => {
	drafts.value = {};
});

/**

 * Relevant Realtime Event Session changes re-resolve the bindings, and a live On-air
 * Update Policy input has to reach air without anybody pressing anything.
 *
 * Only the acceptance is asked for: the server re-resolves from Event Data itself, so
 * this says the facts moved rather than what they moved to. Restricted to an on-air
 * graphic with at least one live-policy bound input, because that is the only case
 * where an acceptance would change what program shows — a staged input already reads
 * as pending, which is exactly what it should.
 */
const hasLiveBoundInput = computed(() => traces.value.some(trace =>
	trace.binding !== undefined && trace.declaration.updatePolicy === 'live',
));

watch(boundValues, (next, previous) => {
	if (!isOnAir.value || !hasLiveBoundInput.value || props.disconnected)
		return;
	if (JSON.stringify(next) === JSON.stringify(previous))
		return;
	void sessionStore.resolveBindings(props.eventId, props.screen.id, props.graphic.id);
});

/**
 * A refused edit gives its field back to the authoritative value.
 *
 * Without this the operator would keep looking at the text they typed while the
 * trace beneath it reported something else — the field would claim to hold an edit
 * that was refused, which is the silent overwrite this whole mechanism exists to
 * make impossible, reproduced in the browser.
 */
watch(
	() => refreshedInputs.value.map(trace => trace.declaration.key),
	(keys) => {
		if (keys.length === 0)
			return;

		const refreshed = { ...drafts.value };
		for (const key of keys)
			delete refreshed[key];
		drafts.value = refreshed;
	},
);
</script>

<template>
	<ScreenSettingsCard title="Live Control" :default-open="true">
		<UIEmptyState
			v-if="traces.length === 0 && pickers.length === 0"
			icon="i-lucide-sliders-horizontal"
			title="No Graphic Inputs"
			description="This Broadcast Graphic declares no operator values."
		/>

		<div v-else class="space-y-3" data-testid="live-control">
			<!--
				One picker per operator-selected Graphic Source Selection. The current
				Event and any selection derived from another resolve without being
				picked, so neither appears here.
			-->
			<div
				v-for="source in pickers"
				:key="source.key"
				class="rounded-lg border border-default/70 p-3"
				:data-graphic-source="source.key"
			>
				<div class="mb-2 flex min-w-0 items-center gap-2">
					<span class="min-w-0 flex-1 truncate text-sm font-medium">{{ source.label }}</span>
					<UBadge size="xs" variant="soft" color="neutral">
						{{ source.kind }}
					</UBadge>
				</div>
				<div class="flex items-center gap-2">
					<USelect
						:model-value="selectedSource(source.key)"
						:items="selectionOptions(source.kind)"
						class="w-full flex-1"
						size="sm"
						placeholder="Nothing selected"
						:data-testid="`live-control-source-${source.key}`"
						@update:model-value="selectSource(source.key, selectionIdOf($event))"
					/>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						:data-testid="`live-control-source-clear-${source.key}`"
						@click="selectSource(source.key, null)"
					>
						Clear
					</UButton>
				</div>
			</div>
			<p v-if="!isOnAir" class="text-xs text-muted" data-testid="live-control-off-note">
				This Broadcast Graphic is off. Edits change the working values its next Take accepts.
			</p>

			<!--
				A refused edit, named. Silently accepting the refresh would leave the
				operator believing their correction is on its way to air.
			-->
			<UAlert
				v-if="refreshedInputs.length > 0"
				data-testid="live-control-refreshed"
				color="warning"
				variant="soft"
				icon="i-lucide-users"
				title="Another operator got there first"
				:description="`${refreshedInputs.map(trace => trace.declaration.label).join(', ')} changed while you were editing, so your change was not applied. These fields now show the accepted value.`"
			/>

			<UAlert
				v-if="blockingInputs.length > 0"
				data-testid="live-control-take-blocked"
				color="warning"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Take is blocked"
				:description="`${blockingInputs.map(trace => trace.declaration.label).join(', ')} must have a value before this Broadcast Graphic can go on air.`"
			/>

			<div
				v-for="trace in traces"
				:key="trace.declaration.key"
				class="rounded-lg border border-default/70 p-3"
				:data-graphic-input="trace.declaration.key"
				:data-graphic-input-status="trace.status"
			>
				<div class="mb-2 flex min-w-0 items-center gap-2">
					<span class="min-w-0 flex-1 truncate text-sm font-medium">{{ trace.declaration.label }}</span>
					<UBadge
						v-if="trace.declaration.required"
						size="xs"
						variant="soft"
						color="neutral"
					>
						Required
					</UBadge>
					<UBadge
						size="xs"
						variant="soft"
						:color="STATUS_COLORS[trace.status]"
						data-testid="live-control-status"
					>
						{{ STATUS_LABELS[trace.status] }}
					</UBadge>
				</div>

				<UInput
					v-if="trace.declaration.type === 'text'"
					:model-value="String(draftValue(trace) ?? '')"
					class="w-full"
					size="sm"
					:disabled="disconnected"
					:data-testid="`live-control-field-${trace.declaration.key}`"
					@update:model-value="editDraft(trace.declaration.key, String($event))"
					@blur="commit(trace.declaration.key)"
					@keydown.enter="commit(trace.declaration.key)"
				/>
				<UInputNumber
					v-else-if="trace.declaration.type === 'number'"
					:model-value="typeof draftValue(trace) === 'number' ? Number(draftValue(trace)) : undefined"
					class="w-full"
					size="sm"
					:disabled="disconnected"
					:data-testid="`live-control-field-${trace.declaration.key}`"
					@update:model-value="commitNow(trace.declaration.key, $event ?? null)"
				/>
				<USwitch
					v-else-if="trace.declaration.type === 'toggle'"
					:model-value="draftValue(trace) === true"
					size="sm"
					:disabled="disconnected"
					:data-testid="`live-control-field-${trace.declaration.key}`"
					@update:model-value="commitNow(trace.declaration.key, Boolean($event))"
				/>
				<USelect
					v-else-if="trace.declaration.type === 'choice'"
					:model-value="typeof draftValue(trace) === 'string' ? String(draftValue(trace)) : undefined"
					:items="choiceOptions(trace)"
					class="w-full"
					size="sm"
					:disabled="disconnected"
					:data-testid="`live-control-field-${trace.declaration.key}`"
					@update:model-value="commitNow(trace.declaration.key, String($event))"
				/>
				<UInput
					v-else-if="trace.declaration.type === 'color'"
					type="color"
					:model-value="String(draftValue(trace) ?? '#000000')"
					size="sm"
					:disabled="disconnected"
					:data-testid="`live-control-field-${trace.declaration.key}`"
					@update:model-value="commitNow(trace.declaration.key, String($event))"
				/>
				<!--
					A media Graphic Input names a pinned Graphics Asset Library revision.
					Choosing one is the asset library's own picker, which arrives with Media
					Graphic Items; until then Live Control shows and clears the pinned
					reference rather than pretending to browse the library.
				-->
				<div v-else class="flex items-center gap-2">
					<span
						class="min-w-0 flex-1 truncate text-xs text-muted"
						:data-testid="`live-control-field-${trace.declaration.key}`"
					>{{ displayValue(trace, draftValue(trace)) }}</span>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						:disabled="disconnected"
						:data-testid="`live-control-clear-${trace.declaration.key}`"
						@click="commitNow(trace.declaration.key, null)"
					>
						Clear
					</UButton>
				</div>

				<p
					v-if="!trace.effective.availability.available"
					class="mt-1 text-xs text-error"
					data-testid="live-control-unavailable"
				>
					{{ trace.status === 'stale'
						? `${trace.effective.availability.reason} — program is still showing the last accepted value.`
						: trace.effective.availability.reason }}
				</p>

				<div v-if="trace.override" class="mt-1 flex items-center gap-2">
					<span class="text-xs text-muted">Masking its binding</span>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						:data-testid="`live-control-clear-override-${trace.declaration.key}`"
						@click="clearOverride(trace.declaration.key)"
					>
						Clear override
					</UButton>
				</div>

				<dl class="mt-2 grid grid-cols-3 gap-2 text-xs">
					<div>
						<dt class="text-muted">
							Bound
						</dt>
						<dd class="truncate" data-testid="live-control-bound">
							{{ trace.bound ? displayValue(trace, trace.bound.value) : (trace.binding ? 'Unresolved' : '—') }}
						</dd>
					</div>
					<div>
						<dt class="text-muted">
							Staged
						</dt>
						<dd class="truncate" data-testid="live-control-working">
							{{ displayValue(trace, trace.effective.value) }}
						</dd>
					</div>
					<div>
						<dt class="text-muted">
							On air
						</dt>
						<dd class="truncate" data-testid="live-control-accepted">
							{{ displayValue(trace, trace.accepted.value) }}
						</dd>
					</div>
				</dl>
			</div>

			<UFieldGroup v-if="isOnAir" size="xs" class="w-full">
				<UButton
					color="primary"
					variant="subtle"
					class="flex-1 justify-center"
					:disabled="disconnected || pending || !hasStagedChanges"
					data-testid="live-control-update"
					@click="update(false)"
				>
					Update Graphic
				</UButton>
				<UButton
					color="primary"
					variant="outline"
					aria-label="Cut Update"
					title="Accept the staged Graphic Inputs and show them immediately"
					:disabled="disconnected || pending || !hasStagedChanges"
					data-testid="live-control-cut-update"
					@click="update(true)"
				>
					Cut
				</UButton>
			</UFieldGroup>
		</div>
	</ScreenSettingsCard>
</template>
