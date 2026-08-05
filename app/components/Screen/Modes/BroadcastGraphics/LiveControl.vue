<script setup lang="ts">
import type {
	BroadcastGraphicsRejectionCode,
	GraphicInputTrace,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicConfig,
	GraphicInputValue,
	GraphicMediaKind,
	GraphicPlayoutState,
} from '~~/shared/types/graphics';
import type {
	GraphicAssetReference,
	GraphicAssetReferenceStatus,
} from '~~/shared/types/graphicsAsset';
import type { Screen } from '~/types';
import {
	graphicInputTextValue,
	isMediaGraphicInputValue,
	isOperatorSelectedGraphicSource,
	resolveGraphicInputBindings,
} from '~~/shared/modules/graphics';
import {
	GRAPHICS_AUTHOR_SESSION_LAPSED_MESSAGE,
	graphicsAuthorSessionLapsed,
} from '~/composables/useGraphicsAuthorSession';
import { graphicAssetReferenceStatus } from '~/utils/graphicAssetReferenceStatus';
import { createKeyedGuardedSequence } from '~/utils/guardedSequence';

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
 * ## Media is chosen, not typed
 *
 * A media Graphic Input's value is one exact Graphic Asset Revision, so its control
 * is the Graphics Asset Library's own picker rather than a field. The acceptance path
 * rebuilds that value from the library and refuses a revision that does not resolve,
 * so the picker asks the library first and stages nothing it would refuse: an
 * operator choosing from a list should never be able to produce that refusal.
 *
 * The window between that question and the acceptance is real but narrow, and the
 * refusal that comes back through it is reported in the same words at the same field,
 * because the operator cannot tell — and should not have to — which side answered.
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

/**
 * The engines of the Screen Outputs open on this Screen right now, so a media
 * revision's playback cost is stated in the picker rather than discovered on air.
 */
const openOutputTargets = useScreenOutputVideoTargets(() => props.screen.id);

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

/**
 * Whether Update Graphic has somewhere to land.
 *
 * Entering, on-air, and updating — and deliberately not exiting. A graphic on its way
 * off air is going, so accepting a staged set for it would put values on program that
 * nobody would see arrive; editing it instead changes the working values its next Take
 * accepts, which is the same rule as editing an off graphic.
 */
const isOnAir = computed(() =>
	props.playoutState === 'entering' || props.playoutState === 'on-air' || props.playoutState === 'updating',
);

/**
 * Why Update Graphic has nowhere to land, in the operator's terms.
 *
 * Waiting says what it actually is rather than "off": the graphic is this Graphic
 * Channel's latest selection and is about to enter, so telling an operator it is off
 * would read as a Take that did not land. Entering, on-air, and updating are absent
 * because `isOnAir` is true for all three, so the note they would carry never renders.
 */
const OFF_AIR_NOTES: Partial<Record<GraphicPlayoutState, string>> = {
	off: 'This Broadcast Graphic is off.',
	waiting: 'This Broadcast Graphic is waiting for its Graphic Channel to clear.',
	exiting: 'This Broadcast Graphic is leaving air.',
};

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

/** Why the last revision an operator chose for one media Graphic Input was not written. */
const mediaRefusals = ref<Record<string, string>>({});

/**
 * One flight per Broadcast Graphic and Graphic Input, superseded whenever this
 * control stops speaking for the graphic that started it.
 *
 * Keyed by both because the key alone is not the identity of the thing being
 * written: two Broadcast Graphics may declare the same Graphic Input key, and every
 * write here names a graphic. An answer that outlived its graphic would stage a
 * revision nobody chose for the graphic now on screen, carrying a Field Ownership
 * claim describing that other graphic's value — which is applied unconditionally,
 * because it is a claim about something the operator never saw.
 */
const mediaSelectionFlights = createKeyedGuardedSequence<string>();

function mediaSelectionKey(inputKey: string): string {
	return `${props.graphic.id}:${inputKey}`;
}

/**
 * How the Graphics Asset Library's refusal of one revision reads to an operator.
 *
 * The same two outcomes the Missing Graphic Asset Reference and Unavailable Graphic
 * Asset Content vocabulary names everywhere else, so the operator's next move —
 * choose something else, or retry the same thing — is the one the words already
 * imply.
 */
const MEDIA_REFUSALS: Record<'missing' | 'unavailable', string> = {
	missing: 'Missing Graphic Asset Reference — that revision no longer exists, so it was not staged.',
	unavailable: 'Unavailable Graphic Asset Content — that revision’s bytes are temporarily unavailable, so it was not staged. Try again.',
};

/**
 * The same two outcomes as the authority names them, when it is the authority that
 * refused rather than the check made before sending.
 *
 * Only these two codes read as a media refusal. The rest of the vocabulary is about
 * the show — a superseded field, a graphic that is off — and each is already reported
 * where it belongs; showing one here would name the wrong thing next to the picker.
 */
const MEDIA_REFUSAL_CODES: Partial<Record<BroadcastGraphicsRejectionCode, string>> = {
	'missing-asset-reference': MEDIA_REFUSALS.missing,
	'unavailable-asset-content': MEDIA_REFUSALS.unavailable,
};

/**
 * Why the last revision chosen for one media Graphic Input was not staged.
 *
 * Two sources, one refusal seen a moment apart. The picker asks the library before it
 * writes anything, so the ordinary case never reaches the command path at all; what
 * remains is the revision that stops resolving between that question and acceptance,
 * which the authority refuses with a rejection code (#203). Read the same way and
 * worded the same way, because to the operator it is the same fact about the same
 * choice — and the alternative for the second one is a banner saying only that a
 * playout action failed.
 */
function mediaRefusal(inputKey: string): string | undefined {
	if (mediaRefusals.value[inputKey])
		return mediaRefusals.value[inputKey];
	const code = sessionStore.inputRefusal(props.screen.id, props.graphic.id, inputKey);
	return code === undefined ? undefined : MEDIA_REFUSAL_CODES[code];
}

/**
 * Stage one exact Graphic Asset Revision for a media Graphic Input.
 *
 * The acceptance path rebuilds the value from the Graphics Asset Library and refuses
 * a revision that does not resolve with a 409, so this asks the library the same
 * question first and writes nothing when the answer is no. An operator choosing from
 * a picker should not be able to produce a refusal the picker could have foreseen —
 * and the alternative, sending it and reporting the 409, would name a failure of the
 * command rather than a fact about the revision.
 *
 * The pinned revision's compatibility facts are deliberately not sent. They are the
 * authoritative side's to record at the moment of acceptance, from the library rather
 * than from a browser — the same route a media Graphic Input's authored default would
 * take, which is how #96 settled that a value carries the same facts however it was
 * chosen. Nothing authors such a default today, so that symmetry is currently a
 * property of the mechanism rather than of two surfaces an operator can compare.
 */
async function selectMedia(key: string, reference: GraphicAssetReference) {
	const flight = mediaSelectionFlights.begin(mediaSelectionKey(key));
	let status: GraphicAssetReferenceStatus;
	try {
		status = await graphicAssetReferenceStatus(reference);
	}
	catch (caught) {
		if (flight.stale)
			return;

		// A lapsed graphics author session is not the library saying anything about
		// this revision, and it is the one failure retrying cannot fix. Reported in
		// the terms the session seam already owns, rather than as bytes that will
		// come back — the fallback is deliberately not `describeFailure`'s, whose
		// non-lapse arm is the raw transport error.
		refuseMedia(key, graphicsAuthorSessionLapsed(caught)
			? GRAPHICS_AUTHOR_SESSION_LAPSED_MESSAGE
			: MEDIA_REFUSALS.unavailable);
		return;
	}
	if (flight.stale)
		return;

	if (status.outcome !== 'available') {
		refuseMedia(key, MEDIA_REFUSALS[status.outcome]);
		return;
	}

	const { [key]: _resolved, ...rest } = mediaRefusals.value;
	mediaRefusals.value = rest;
	commitNow(key, { assetId: reference.assetId, revisionId: reference.revisionId });
}

function refuseMedia(key: string, reason: string) {
	mediaRefusals.value = { ...mediaRefusals.value, [key]: reason };
}

/** The media kind a Graphic Input declares, which is the only kind its picker offers. */
function mediaKindOf(trace: GraphicInputTrace): GraphicMediaKind {
	return trace.declaration.type === 'media' ? trace.declaration.mediaKind : 'image';
}

/**
 * The revision this media Graphic Input currently holds, for the picker to report on.
 *
 * Given rather than withheld because the picker is what asks the library about a
 * pinned revision — a Missing Graphic Asset Reference, Unavailable Graphic Asset
 * Content, and the retry for it. Told nothing, it reports nothing, and a staged
 * revision that had since gone would read as a healthy value until it went on air.
 *
 * Asked of the stored value rather than assumed from the declaration, because a
 * Graphic Input holds what was written to it even when that violates its type.
 */
function mediaValueOf(trace: GraphicInputTrace): GraphicAssetReference | undefined {
	const value = fieldValue(trace);
	return isMediaGraphicInputValue(value) ? value : undefined;
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
// whatever the previously selected graphic had typed into it — and a refusal the
// library gave about that graphic's revision says nothing about this one's.
watch(() => props.graphic.id, () => {
	drafts.value = {};
	mediaRefusals.value = {};
	mediaSelectionFlights.supersedeAll();
});

/**
 * A control that has gone speaks for nothing.
 *
 * Without this, a library answer settling after teardown still runs its side effects
 * — staging a revision onto a Broadcast Graphic nobody is looking at, from a
 * component that no longer exists.
 */
onBeforeUnmount(() => {
	mediaSelectionFlights.supersedeAll();
});

/*
 * Live Control issues no Resolve Bindings of its own.
 *
 * "Relevant Realtime Event Session changes re-resolve affected Graphic Input
 * Bindings" is answered by the authoritative side, which re-resolves whenever Event
 * Data changes. A watcher here could only ever cover the one graphic this component
 * is showing, which is the scoping that made an on-air lower third hold a stale name
 * whenever the operator was looking at a different graphic.
 *
 * It is deliberately not kept as a second opinion either. The bound value an operator
 * reads is computed in this component from Event Data the Realtime Event Session has
 * already delivered, so nothing here waits on a round trip; what the command changes
 * is the *accepted* value, which needs the server whichever side asks for it. And the
 * command path has no "would this change anything" guard — that guard lives in the
 * sweep — so a watcher would send a second, always-redundant command after every
 * relevant change, advancing the authoritative sequence that every Live Control and
 * Screen Output on this Screen then reloads against.
 */

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
				{{ OFF_AIR_NOTES[playoutState] }}
				Edits change the working values its next Take accepts.
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
					A media Graphic Input names a pinned Graphics Asset Library revision, and
					this is where an operator chooses one. The picker offers only the media
					kind the Graphic Input declares — the reference index matches a
					reference's kind against the asset's, so a revision of the other kind
					would be accepted and then never published — and it is given the engines
					open now so a clip's playback cost is legible before the choice.
				-->
				<div v-else class="space-y-2">
					<div class="flex items-center gap-2">
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
					<GraphicsAssetFocusPicker
						:model-value="mediaValueOf(trace)"
						:clearable="false"
						:event-id="eventId"
						:field-label="trace.declaration.label"
						:asset-kind="mediaKindOf(trace)"
						video-target="chromium"
						:open-output-targets="openOutputTargets"
						:disabled="disconnected"
						:data-testid="`live-control-media-${trace.declaration.key}`"
						@select="(_asset, reference) => selectMedia(trace.declaration.key, reference)"
					/>
					<p
						v-if="mediaRefusal(trace.declaration.key)"
						class="text-xs text-error"
						:data-testid="`live-control-media-refused-${trace.declaration.key}`"
					>
						{{ mediaRefusal(trace.declaration.key) }}
					</p>
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
