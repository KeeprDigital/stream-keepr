<script setup lang="ts">
import type { Game } from '~~/shared/types/enums';
import type {
	BroadcastGraphicConfig,
	GraphicInputDeclaration,
	GraphicSourceDerivation,
	GraphicSourceSelectionDeclaration,
	GraphicSourceSelectionKind,
} from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { getGameConfig } from '~~/shared/config/games';
import {
	addGraphicSourceSelection,
	bindableGraphicBindingFields,
	canAddGraphicSourceSelection,
	deleteGraphicInputBinding,
	deleteGraphicSourceSelection,
	GRAPHIC_SOURCE_RELATION_LABELS,
	GRAPHIC_SOURCE_SELECTION_KIND_LABELS,
	graphicSourceDerivationOptions,
	isGraphicBindingFieldCompatible,
	isOperatorSelectedGraphicSource,
	patchGraphicSourceSelection,
	setGraphicInputBinding,
	setGraphicSourceDerivation,
} from '~~/shared/modules/graphics';
import {
	GRAPHIC_SOURCE_SELECTION_KIND_VALUES,
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
} from '~~/shared/types/graphics';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';

/**
 * Authoring the Event Data one Broadcast Graphic reads: its Graphic Source
 * Selections, and the Graphic Input Binding each of its Graphic Inputs may have.
 *
 * ## Why the surface only offers what resolves
 *
 * The write path refuses a derived Graphic Source Selection that names a
 * relationship its parent cannot follow, one whose relationship yields another kind,
 * and a `from` chain that loops; it allows one Graphic Input Binding per Graphic
 * Input and only catalog field names. Every one of those rules is a list here rather
 * than an error afterwards — an author picks a derivation from the ones the relation
 * table actually yields, and a field from the ones this selection's kind offers, this
 * Event's game has, and the Graphic Input's type can hold.
 *
 * The catalog goes further than the write path has to. A `fieldId` is checked on the
 * wire across all eight kinds at once, so `player.name` on a Feature Match Slot
 * selection is storable and then resolves nothing forever. Offering only
 * `bindableGraphicBindingFields` is what makes that combination unauthorable here.
 *
 * ## Why a kind is chosen once
 *
 * A Graphic Source Selection's kind is fixed at declaration, as a Graphic Input's
 * type is: the kind decides which catalog fields the bindings reading it may name, so
 * changing it in place would strand every binding already reading it. The label is
 * what an author renames, and the key never moves.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	/**
	 * The game of the Event this Broadcast Graphic is placed in, which decides which
	 * game-specific catalog fields exist at all. Absent offers every game's fields,
	 * the lenient no-Event-context case the catalog documents.
	 */
	game?: Game;
	/** Whether this session holds the artifact's Graphics Authoring Lease. */
	writable?: boolean;
}>();

const emit = defineEmits<{ 'update:graphics': [graphics: BroadcastGraphicConfig[]] }>();

/** Fail closed, as everywhere else: an unstated permission is not a granted one. */
const canAuthor = computed(() => props.writable === true);

const selection = computed(() => resolveGraphicsSelection(props.graphics, props.selectedTarget));

/**
 * Graphic Source Selections and Graphic Input Bindings belong to the Broadcast
 * Graphic rather than to any one Graphic Item, so this panel appears with the graphic
 * itself selected — the same place its Graphic Inputs are declared.
 */
const selectedGraphic = computed<BroadcastGraphicConfig | null>(() =>
	selection.value.kind === 'graphic' ? selection.value.graphic : null,
);

const sources = computed<GraphicSourceSelectionDeclaration[]>(() => selectedGraphic.value?.sources ?? []);
const inputs = computed<GraphicInputDeclaration[]>(() => selectedGraphic.value?.inputs ?? []);

/**
 * The Graphic Inputs a binding control is offered for.
 *
 * None until a Graphic Source Selection exists to name, and none while this Event's
 * game is unknown — the catalog's lenient no-game path would offer every game's
 * fields, and a binding made in that window is not corrected when the game arrives.
 */
const bindableInputs = computed(() =>
	sources.value.length > 0 && props.game !== undefined ? inputs.value : [],
);

const SOURCE_KIND_OPTIONS = GRAPHIC_SOURCE_SELECTION_KIND_VALUES.map(kind => ({
	label: GRAPHIC_SOURCE_SELECTION_KIND_LABELS[kind],
	value: kind,
}));

const newSourceKind = ref<GraphicSourceSelectionKind>('player');

/**
 * The Graphic Source Selection an author has chosen for a Graphic Input but not yet
 * given a field.
 *
 * A binding names a field, so there is no half-written one to store: choosing a
 * source is held here until a field turns it into a Graphic Input Binding. Cleared
 * with the selection, because a draft belongs to the graphic it was started on.
 */
const draftSourceKeys = ref<Record<string, string>>({});

watch(() => selectedGraphic.value?.id, () => {
	draftSourceKeys.value = {};
});

function applyToGraphic(
	merge: (graphics: readonly BroadcastGraphicConfig[], graphicId: string) => BroadcastGraphicConfig[],
) {
	const graphic = selectedGraphic.value;
	if (!canAuthor.value || !graphic)
		return;
	emit('update:graphics', merge(props.graphics, graphic.id));
}

/**
 * Whether another Graphic Source Selection fits, on this Broadcast Graphic and across
 * the Screen. The control is disabled rather than silently declining, so an author
 * meets the budget as a fact about the Screen rather than as a click that did nothing.
 */
const canDeclareSource = computed(() =>
	selectedGraphic.value !== null && canAddGraphicSourceSelection(props.graphics, selectedGraphic.value.id),
);

function addSource() {
	applyToGraphic((graphics, graphicId) => addGraphicSourceSelection(graphics, graphicId, newSourceKind.value));
}

/**
 * Rename one Graphic Source Selection, ignoring a blank.
 *
 * The write path requires a label of at least one character, so clearing the field
 * writes nothing at all and the previous name stands until another is typed —
 * an author mid-rename is not asking for a nameless selection. The operation refuses
 * one too; this is the half that keeps a cleared field from writing the Screen.
 */
function renameSource(key: string, label: string) {
	if (label.trim() === '')
		return;
	applyToGraphic((graphics, graphicId) => patchGraphicSourceSelection(graphics, graphicId, key, { label }));
}

function removeSource(key: string) {
	applyToGraphic((graphics, graphicId) => deleteGraphicSourceSelection(graphics, graphicId, key));
}

function sourceByKey(key: string): GraphicSourceSelectionDeclaration | undefined {
	return sources.value.find(source => source.key === key);
}

function sourceLabel(key: string): string {
	return sourceByKey(key)?.label ?? key;
}

/**
 * One derivation as a single select value: `sourceKey:relation`, unambiguous because
 * a Graphic Source Selection key starts with a letter and holds only letters, digits,
 * underscores, and hyphens.
 *
 * What comes back is resolved against the offered derivations rather than parsed into
 * a relation, so a value this panel did not offer names nothing and writes nothing —
 * the alternative casts half a string into the relation vocabulary and trusts it.
 */
const OPERATOR_SELECTED = '';

function derivationKey(from: GraphicSourceDerivation): string {
	return `${from.sourceKey}:${from.relation}`;
}

function derivationValue(source: GraphicSourceSelectionDeclaration): string {
	return source.from ? derivationKey(source.from) : OPERATOR_SELECTED;
}

function derivationOptions(source: GraphicSourceSelectionDeclaration) {
	return [
		{ label: 'An operator picks it', value: OPERATOR_SELECTED },
		...graphicSourceDerivationOptions(sources.value, source.key).map(option => ({
			label: `${GRAPHIC_SOURCE_RELATION_LABELS[option.relation]} of ${sourceLabel(option.sourceKey)}`,
			value: derivationKey(option),
		})),
	];
}

function chooseDerivation(key: string, value: string) {
	if (value === OPERATOR_SELECTED) {
		applyToGraphic((graphics, graphicId) => setGraphicSourceDerivation(graphics, graphicId, key, undefined));
		return;
	}

	const from = graphicSourceDerivationOptions(sources.value, key)
		.find(option => derivationKey(option) === value);
	if (!from)
		return;

	applyToGraphic((graphics, graphicId) => setGraphicSourceDerivation(graphics, graphicId, key, from));
}

/**
 * What one Graphic Source Selection resolves from, in the author's terms.
 *
 * Whether it generates a picker is asked of the same predicate Live Control
 * generates its pickers from, rather than restated here — otherwise this panel could
 * promise an operator a control that never appears.
 */
function sourceNote(source: GraphicSourceSelectionDeclaration): string {
	if (isOperatorSelectedGraphicSource(source))
		return 'Generates one picker in Live Control.';
	if (source.from)
		return `Follows ${sourceLabel(source.from.sourceKey)} — no picker of its own.`;
	return 'Resolves the Event this Screen belongs to.';
}

/* ────────────────────────────────────────────────
 * Graphic Input Bindings
 * ──────────────────────────────────────────────── */

function bindingFor(inputKey: string) {
	return selectedGraphic.value?.bindings?.find(binding => binding.inputKey === inputKey);
}

/** The Graphic Source Selection a Graphic Input reads, bound or merely chosen. */
function boundSourceKey(inputKey: string): string {
	return bindingFor(inputKey)?.sourceKey ?? draftSourceKeys.value[inputKey] ?? OPERATOR_SELECTED;
}

function bindingSourceOptions() {
	return [
		{ label: 'Entered manually', value: OPERATOR_SELECTED },
		...sources.value.map(source => ({
			label: `${source.label} (${GRAPHIC_SOURCE_SELECTION_KIND_LABELS[source.kind]})`,
			value: source.key,
		})),
	];
}

/**
 * Point one Graphic Input at a Graphic Source Selection.
 *
 * A field of the previous selection is kept only where the new selection's kind
 * offers it too, which is the case where the author is moving between two selections
 * of one kind. Otherwise the binding is dropped rather than left naming a field the
 * new kind does not have, and the author chooses a field again.
 */
function chooseBindingSource(input: GraphicInputDeclaration, sourceKey: string) {
	if (sourceKey === OPERATOR_SELECTED) {
		draftSourceKeys.value = { ...draftSourceKeys.value, [input.key]: OPERATOR_SELECTED };
		applyToGraphic((graphics, graphicId) => deleteGraphicInputBinding(graphics, graphicId, input.key));
		return;
	}

	draftSourceKeys.value = { ...draftSourceKeys.value, [input.key]: sourceKey };

	const source = sourceByKey(sourceKey);
	const fieldId = bindingFor(input.key)?.fieldId;
	if (!source || fieldId === undefined)
		return;

	applyToGraphic((graphics, graphicId) =>
		isGraphicBindingFieldCompatible(source.kind, fieldId, input.type, props.game)
			? setGraphicInputBinding(graphics, graphicId, { inputKey: input.key, sourceKey, fieldId }, props.game)
			: deleteGraphicInputBinding(graphics, graphicId, input.key),
	);
}

function chooseBindingField(input: GraphicInputDeclaration, fieldId: string) {
	const sourceKey = boundSourceKey(input.key);
	if (sourceKey === OPERATOR_SELECTED)
		return;

	applyToGraphic((graphics, graphicId) =>
		setGraphicInputBinding(graphics, graphicId, { inputKey: input.key, sourceKey, fieldId }, props.game),
	);
}

function clearBinding(inputKey: string) {
	draftSourceKeys.value = { ...draftSourceKeys.value, [inputKey]: OPERATOR_SELECTED };
	applyToGraphic((graphics, graphicId) => deleteGraphicInputBinding(graphics, graphicId, inputKey));
}

/** The fields this Graphic Input may bind to, in the two groups an author reads. */
function bindingFieldGroups(input: GraphicInputDeclaration) {
	const source = sourceByKey(boundSourceKey(input.key));
	if (!source || props.game === undefined)
		return [];

	const { common, gameSpecific } = bindableGraphicBindingFields(source.kind, input.type, props.game);
	const gameLabel = getGameConfig(props.game).label;

	return [
		common.length > 0
			? [{ type: 'label' as const, label: 'Common fields' }, ...common.map(field => ({ label: field.label, value: field.id }))]
			: [],
		gameSpecific.length > 0
			? [{ type: 'label' as const, label: `${gameLabel} fields` }, ...gameSpecific.map(field => ({ label: field.label, value: field.id }))]
			: [],
	].filter(group => group.length > 0);
}

/**
 * Why a chosen Graphic Source Selection has nothing this Graphic Input can read.
 *
 * Type compatibility is the catalog's decision rather than a conversion, so an author
 * who reaches an empty picker is told which type they are asking for and of what —
 * "no Talent field holds a number" is a fact they can act on by binding a different
 * input or choosing another selection.
 */
function unbindableReason(input: GraphicInputDeclaration): string | null {
	const binding = bindingFor(input.key);
	const source = sourceByKey(boundSourceKey(input.key));

	// A binding whose Graphic Source Selection is gone resolves nothing and says
	// nothing, because removing a selection here takes its bindings with it. One
	// written straight to the mode configuration can still arrive in this state.
	if (binding && !source)
		return `This reads ${binding.sourceKey}, which this Broadcast Graphic no longer declares.`;
	if (!source || bindingFieldGroups(input).length > 0)
		return null;
	if (props.game === undefined)
		return null;

	return `No ${GRAPHIC_SOURCE_SELECTION_KIND_LABELS[source.kind]} field holds a ${input.type} value on this Event.`;
}
</script>

<template>
	<div v-if="selectedGraphic" class="space-y-4" data-testid="graphic-event-data-bindings">
		<div class="flex items-end gap-2">
			<UFormField label="Graphic Source Selections" size="sm" class="flex-1">
				<USelect
					:model-value="newSourceKind"
					:items="SOURCE_KIND_OPTIONS"
					class="w-full"
					size="sm"
					data-testid="graphic-source-kind"
					@update:model-value="newSourceKind = $event"
				/>
			</UFormField>
			<UButton
				size="sm"
				variant="soft"
				icon="i-lucide-plus"
				:disabled="!canDeclareSource"
				data-testid="graphic-source-add"
				@click="addSource()"
			>
				Declare
			</UButton>
		</div>

		<p v-if="!canDeclareSource" class="text-xs text-warning" data-testid="graphic-source-budget-spent">
			This Broadcast Graphics Screen has no room for another Graphic Source Selection:
			one Broadcast Graphic may declare {{ MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC }},
			and the Screen {{ MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN }} in total.
		</p>

		<div
			v-for="source in sources"
			:key="source.key"
			class="space-y-2 rounded-lg border border-default/70 p-2"
			:data-graphic-source-selection="source.key"
		>
			<div class="flex items-center gap-2">
				<UInput
					:model-value="source.label"
					class="min-w-0 flex-1"
					size="sm"
					:maxlength="MAX_GRAPHIC_INPUT_LABEL_LENGTH"
					data-testid="graphic-source-label"
					@update:model-value="renameSource(source.key, String($event))"
				/>
				<UBadge size="xs" variant="soft">
					{{ GRAPHIC_SOURCE_SELECTION_KIND_LABELS[source.kind] }}
				</UBadge>
				<UButton
					size="xs"
					variant="ghost"
					color="error"
					icon="i-lucide-trash-2"
					aria-label="Stop declaring this Graphic Source Selection"
					data-testid="graphic-source-delete"
					@click="removeSource(source.key)"
				/>
			</div>

			<!--
				The kind is chosen once and the key never moves, so both are read here
				rather than edited: a Graphic Input Binding, a derived selection, and an
				operator's live pick all name the key.
			-->
			<p class="font-mono text-xs text-muted" data-testid="graphic-source-key">
				{{ source.key }}
			</p>

			<UFormField v-if="source.kind !== 'event'" label="Selected by" size="xs">
				<USelect
					:model-value="derivationValue(source)"
					:items="derivationOptions(source)"
					class="w-full"
					size="sm"
					data-testid="graphic-source-derivation"
					@update:model-value="chooseDerivation(source.key, String($event))"
				/>
			</UFormField>

			<p class="text-xs text-muted" data-testid="graphic-source-note">
				{{ sourceNote(source) }}
			</p>
		</div>

		<!--
			One Graphic Input Binding per Graphic Input, which is the rule the write path
			states as "a Graphic Input may have at most one": the surface has one control
			per input rather than a list bindings could repeat an input in.
		-->
		<template v-if="inputs.length > 0">
			<p class="text-sm font-semibold">
				Graphic Input Bindings
			</p>

			<p v-if="sources.length === 0" class="text-xs text-muted" data-testid="graphic-binding-needs-source">
				Declare a Graphic Source Selection to bind a Graphic Input to Event Data.
			</p>

			<!--
				Inert rather than lenient while this Event's game is unknown. The catalog
				offers every game's fields when it is passed none, which is right for a
				surface with no Event context and wrong here: this Event has a game, it has
				simply not arrived yet, and binding a One Piece field on a Magic Event is
				not something a later load undoes.
			-->
			<p v-else-if="game === undefined" class="text-xs text-muted" data-testid="graphic-binding-awaits-game">
				Waiting for this Event's game, which decides the fields a Graphic Input may bind to.
			</p>

			<div
				v-for="input in bindableInputs"
				:key="input.key"
				class="space-y-2 rounded-lg border border-default/70 p-2"
				:data-graphic-input-binding="input.key"
			>
				<div class="flex items-center gap-2">
					<p class="min-w-0 flex-1 truncate text-sm">
						{{ input.label }}
					</p>
					<UBadge size="xs" variant="soft">
						{{ input.type }}
					</UBadge>
					<UButton
						v-if="bindingFor(input.key)"
						size="xs"
						variant="ghost"
						icon="i-lucide-unlink"
						aria-label="Stop binding this Graphic Input"
						data-testid="graphic-binding-clear"
						@click="clearBinding(input.key)"
					/>
				</div>

				<UFormField label="Reads" size="xs">
					<USelect
						:model-value="boundSourceKey(input.key)"
						:items="bindingSourceOptions()"
						class="w-full"
						size="sm"
						data-testid="graphic-binding-source"
						@update:model-value="chooseBindingSource(input, String($event))"
					/>
				</UFormField>

				<UFormField v-if="bindingFieldGroups(input).length > 0" label="Field" size="xs">
					<USelect
						:model-value="bindingFor(input.key)?.fieldId"
						:items="bindingFieldGroups(input)"
						placeholder="Choose a field"
						class="w-full"
						size="sm"
						data-testid="graphic-binding-field"
						@update:model-value="chooseBindingField(input, String($event))"
					/>
				</UFormField>

				<p v-else-if="unbindableReason(input)" class="text-xs text-warning" data-testid="graphic-binding-unavailable">
					{{ unbindableReason(input) }}
				</p>
			</div>
		</template>
	</div>
</template>
