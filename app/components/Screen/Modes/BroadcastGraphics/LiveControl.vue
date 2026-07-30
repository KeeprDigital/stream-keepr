<script setup lang="ts">
import type { GraphicInputTrace } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicConfig,
	GraphicInputValue,
	GraphicPlayoutState,
} from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { graphicInputTextValue } from '~~/shared/modules/graphics';

/**
 * Generated Live Control for one placed Broadcast Graphic.
 *
 * Every control here is generated from a declared Graphic Input: an operator
 * selects and edits declared values and can never author a binding, a custom
 * control, a query, or an expression. There is no authoring surface, which is why
 * this component reads the declarations and writes only values.
 *
 * ## Three values, shown as three
 *
 * Each field shows its latest bound value, the working value being edited, and the
 * accepted on-air value, because an operator has to be able to trust what program
 * shows over what is staged. A value that violates its declared type or
 * constraints is shown as unavailable together with the reason and is never
 * silently corrected — the operator sees exactly what they entered.
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
}>();

const sessionStore = useBroadcastGraphicsLiveSessionStore();

/** Locally typed values, committed to the working value on change or blur. */
const drafts = ref<Record<string, GraphicInputValue>>({});

const traces = computed<GraphicInputTrace[]>(() =>
	sessionStore.inputTraces(props.screen.id, props.graphic),
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

/** Update Graphic has something to accept exactly when an edit is not yet on air. */
const hasStagedChanges = computed(() => traces.value.some(trace => trace.pending));

/**
 * The required Graphic Inputs that stop this Broadcast Graphic going on air.
 *
 * Shown before the operator presses Take rather than only as the refusal, so the
 * missing value is a thing to fix rather than a surprise on air.
 */
const blockingInputs = computed(() => traces.value.filter(trace => trace.blocksTake));

function draftValue(trace: GraphicInputTrace): GraphicInputValue {
	return trace.declaration.key in drafts.value
		? drafts.value[trace.declaration.key]!
		: trace.working.value;
}

function editDraft(key: string, value: GraphicInputValue) {
	drafts.value = { ...drafts.value, [key]: value };
}

/**
 * Write one working value.
 *
 * The server accepts working values, so this is what makes an edit visible to
 * every other session immediately rather than when its author chooses to share it.
 */
function commit(key: string, value?: GraphicInputValue) {
	const next = value === undefined ? drafts.value[key] : value;
	if (next === undefined)
		return;
	void sessionStore.setInput(props.eventId, props.screen.id, props.graphic.id, key, next);
}

function commitNow(key: string, value: GraphicInputValue) {
	editDraft(key, value);
	commit(key, value);
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
	pending: 'Pending',
	unavailable: 'Unavailable',
};

// A new selection starts from the authoritative working values rather than from
// whatever the previously selected graphic had typed into it.
watch(() => props.graphic.id, () => {
	drafts.value = {};
});
</script>

<template>
	<ScreenSettingsCard title="Live Control" :default-open="true">
		<UIEmptyState
			v-if="traces.length === 0"
			icon="i-lucide-sliders-horizontal"
			title="No Graphic Inputs"
			description="This Broadcast Graphic declares no operator values."
		/>

		<div v-else class="space-y-3" data-testid="live-control">
			<p v-if="!isOnAir" class="text-xs text-muted" data-testid="live-control-off-note">
				{{ playoutState === 'exiting' ? 'This Broadcast Graphic is leaving air.' : 'This Broadcast Graphic is off.' }}
				Edits change the working values its next Take accepts.
			</p>

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
						:color="trace.status === 'unavailable' ? 'error' : trace.status === 'pending' ? 'warning' : 'neutral'"
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
					:data-testid="`live-control-field-${trace.declaration.key}`"
					@update:model-value="commitNow(trace.declaration.key, $event ?? null)"
				/>
				<USwitch
					v-else-if="trace.declaration.type === 'toggle'"
					:model-value="draftValue(trace) === true"
					size="sm"
					:data-testid="`live-control-field-${trace.declaration.key}`"
					@update:model-value="commitNow(trace.declaration.key, Boolean($event))"
				/>
				<USelect
					v-else-if="trace.declaration.type === 'choice'"
					:model-value="typeof draftValue(trace) === 'string' ? String(draftValue(trace)) : undefined"
					:items="choiceOptions(trace)"
					class="w-full"
					size="sm"
					:data-testid="`live-control-field-${trace.declaration.key}`"
					@update:model-value="commitNow(trace.declaration.key, String($event))"
				/>
				<UInput
					v-else-if="trace.declaration.type === 'color'"
					type="color"
					:model-value="String(draftValue(trace) ?? '#000000')"
					size="sm"
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
						:data-testid="`live-control-clear-${trace.declaration.key}`"
						@click="commitNow(trace.declaration.key, null)"
					>
						Clear
					</UButton>
				</div>

				<p
					v-if="!trace.working.availability.available"
					class="mt-1 text-xs text-error"
					data-testid="live-control-unavailable"
				>
					{{ trace.working.availability.reason }}
				</p>

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
							Working
						</dt>
						<dd class="truncate" data-testid="live-control-working">
							{{ displayValue(trace, trace.working.value) }}
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
					:disabled="pending || !hasStagedChanges"
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
					:disabled="pending || !hasStagedChanges"
					data-testid="live-control-cut-update"
					@click="update(true)"
				>
					Cut
				</UButton>
			</UFieldGroup>
		</div>
	</ScreenSettingsCard>
</template>
