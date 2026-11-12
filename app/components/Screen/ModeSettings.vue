<script setup lang="ts">
import type { DeckModeConfig } from '~~/shared/screenModeConfigs/deck';
import type { ScreenSettingsCard, ScreenSettingsContext } from '~~/shared/screenModeConfigs/fields';
import type { ScreenModeConfigPatch } from '~~/shared/types/screenConfig';
import type { ScreenModeSettingsSlotProps, SettingsPageCard, SettingsPageField, SettingsPageSection } from '~/modules/screen-mode/settingsPage';
import type { Screen } from '~/types';
import { withEveryColumn } from '~~/shared/screenModeConfigs/subShapes';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { FOLLOWS_THE_THEME, headerSummary, paginationSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { useEditedScreenModeData } from '~/modules/screen-mode/editorModeData';
import { PAGED_MODE_DATA } from '~/modules/screen-mode/pagedModeData';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';
import { cardFieldsSummary, fieldDescription, fieldLabel, fieldOptions, fieldPatch, isPageRotationMode, settingsPageCards } from '~/modules/screen-mode/settingsPage';

/**
 * The generic settings renderer (#1060, #1094): a Screen Mode's settings page
 * drawn from its config contract and its Mode Token declarations, so a mode
 * writes no settings component for its plain fields.
 *
 * Its cards run in one fixed order (Live, Source, Content, Header, Paging,
 * Background & Placement), a card holding nothing is not drawn, and each
 * card ends with its Look (`ScreenSettingsLook`). A field or group whose
 * condition is false for the Screen is not rendered. Every edit writes the
 * patch naming its field; on a paginated mode it goes through the Page
 * Rotation's writes (ADR-0039), and a Source edit returns to page 1, as does a
 * Content field that reorders or recounts the rows (`returnsToFirstPage`).
 *
 * A field no plain control can edit names a slot (`slot` on its editor
 * description), and its widget mounts as the renderer's slot of that name,
 * once per card, where the first field naming it sits. The slot is given
 * `fields` (the shown fields naming it, with their paths and context),
 * `config` and `context` as the page reads them, `update(patch)`, which
 * writes through the same path as every field, and `rotation`, a paginated
 * mode's Page Rotation writes. The renderer fills `page-rotation` (manual
 * page selection) and `columns` (a column list per field) itself; a mode
 * with another slot gets a component of its own that wraps the renderer,
 * fills that slot, and passes on the renderer's exposed `resetConfig` and
 * `saving`. Such a component may also fill `after:<group>` (`after:<card>`
 * for a card's ungrouped fields), drawn at the end of that section while it
 * shows, for a widget editing no field, such as a read-only Event setting.
 * Every slot is also given `data`, a paginated mode's data as read.
 *
 * A widget that edits no one field, such as a choice between two ways of
 * writing a block, mounts as the slot `before:<group>`, at the head of that
 * Screen Settings Group's section, under its heading, while the group shows.
 * It is given the same props, with no `fields`.
 *
 * A group declared `layout: 'row'` draws its fields as one row its title
 * names, each control named by its field's label, with no heading: three card
 * badges are three rows. Its fields name no slot.
 *
 * The mode is the Screen's at setup: the page remounts it on a mode change.
 */
const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

defineSlots<Record<string, (props: ScreenModeSettingsSlotProps) => unknown>>();

const mode = props.screen.currentMode;
const contract = screenModeConfigContract(mode);

const eventStore = useEventStore();
const playerListStore = usePlayerListStore();

// Whether the Event holds a Player List decides what a mode naming one offers, such as its Metagame Scope.
const namesPlayerList = Object.values(contract.fields as Record<string, { reference?: string }>)
	.some(field => field.reference === 'playerList');
if (namesPlayerList) {
	useConsumedEventData(['playerLists']);
	onMounted(async () => {
		if (props.eventId && !playerListStore.isLoaded)
			await playerListStore.loadByEventId(props.eventId);
	});
}

const { config, saving, updateConfig: saveConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	mode,
);

defineExpose({ resetConfig, saving });

const configRecord = computed(() => config.value as Readonly<Record<string, any>>);

// A paginated mode counts its pages from the rows its Screen Output renders,
// read as that output reads them (#780), and writes through its rotation.
function usePaging() {
	if (!isPageRotationMode(mode))
		return undefined;
	const data = useEditedScreenModeData(
		{
			screen: () => props.screen,
			eventId: () => props.eventId,
			saving: () => saving.value,
		},
		PAGED_MODE_DATA[mode],
	);
	const rotation = useRotationConfigWrites({
		mode,
		config: config as never,
		rowCount: data.rowCount,
		saveConfig: saveConfig as never,
	});
	return { data, rotation };
}
const paged = usePaging();

// A Deck List Screen's boards run their columns no further than the cards its Deck Source gives them (ADR-0054).
const deckBoardCards = mode === 'deck'
	? useDeckBoardCards(() => configRecord.value as Partial<DeckModeConfig>, () => props.eventId)
	: undefined;

const context = computed<ScreenSettingsContext>(() => ({
	config: configRecord.value,
	event: eventStore.event,
	hasPlayerLists: playerListStore.lists.length > 0,
	deckBoardCards: deckBoardCards?.value,
}));

const cards = computed(() => settingsPageCards(mode, context.value));

/** Writes a patch of the mode's config: through the Page Rotation on a paginated mode, which restarts it on a shape change. */
function update(patch: Record<string, unknown>) {
	if (!paged) {
		saveConfig(patch as ScreenModeConfigPatch<typeof mode>);
		return;
	}
	const { autoPageEnabled, ...rest } = patch;
	if (typeof autoPageEnabled === 'boolean')
		paged.rotation.setAutoPageEnabled(autoPageEnabled);
	if (Object.keys(rest).length > 0)
		paged.rotation.updateConfig(rest as never);
}

/** Writes one field's new value, and what it writes with it; a Source edit on a paginated mode shows page 1 of what it now reads. */
function updateField(entry: SettingsPageField, value: unknown) {
	const patch = {
		...fieldPatch(entry, value),
		...entry.field.writesWith?.(value, entry.context),
	};
	update(paged && entry.field.card === 'source'
		? { ...patch, currentPage: 1 }
		: patch);
}

// ── The renderer's own slots ──

function columnLabels(entry: SettingsPageField): Record<string, string> {
	return Object.fromEntries((fieldOptions(entry) ?? []).map(option => [option.value, option.label]));
}

/** A column list as the Screen holds it, with any column added since it was stored offered hidden. */
function heldColumns(entry: SettingsPageField): { key: string; visible: boolean }[] {
	const defaults = (contract.defaults as Record<string, unknown>)[entry.field.key];
	const stored = configRecord.value[entry.field.key];
	return withEveryColumn(
		Array.isArray(stored)
			? stored
			: [],
		Array.isArray(defaults)
			? defaults
			: [],
	);
}

/** Whether a column list offers `key`: every column, or where its field labels columns, those labelled for this Screen, such as the ones its Card Game reads. */
function offersColumn(entry: SettingsPageField, key: string): boolean {
	return !entry.field.options || key in columnLabels(entry);
}

function columnsOf(entry: SettingsPageField): { key: string; visible: boolean }[] {
	return heldColumns(entry).filter(column => offersColumn(entry, column.key));
}

/** Writes an edited column list, the columns it does not offer kept after it as stored. */
function updateColumns(entry: SettingsPageField, offered: { key: string; visible: boolean }[]) {
	updateField(entry, [
		...offered,
		...heldColumns(entry).filter(column => !offersColumn(entry, column.key)),
	]);
}

// ── Closed card summaries ──

/** Live and Source hold what an operator reaches for during a show, so they stay open. */
const COLLAPSIBLE: ReadonlySet<ScreenSettingsCard> = new Set([
	'content',
	'header',
	'paging',
	'background-placement',
]);

function summaryOf(card: SettingsPageCard): string | undefined {
	if (card.card === 'header' && 'showHeader' in contract.fields)
		return headerSummary(configRecord.value as { showHeader: boolean; headerText?: string | null });
	if (card.card === 'paging' && paged)
		return paginationSummary(paged.rotation);
	return settingsSummary(cardFieldsSummary(card), card.sections.length === 0
		? FOLLOWS_THE_THEME
		: undefined) || undefined;
}

function slotFieldKeys(fields: readonly SettingsPageField[]): string {
	return fields.map(entry => entry.path.join('.')).join(' ');
}

/** The slot drawn at the end of a card's section: after its group, or after the card's ungrouped fields. */
function afterSlot(card: ScreenSettingsCard, group: string | undefined): string {
	return `after:${group ?? card}`;
}

function headingId(card: ScreenSettingsCard, group: string): string {
	return `${mode}-${card}-${group}-heading`;
}

/** Whether a section's group lays its fields out as one row. */
function isRow(section: SettingsPageSection): boolean {
	return section.group?.layout === 'row';
}

/** A row's description: its first field's, which says what the group is (a badge's show toggle). */
function rowDescription(section: SettingsPageSection): string | undefined {
	const first = section.rows[0];
	return first?.kind === 'field'
		? fieldDescription(first.entry)
		: undefined;
}

/** What every slot is given but its `fields`. */
const slotProps = computed(() => ({
	config: configRecord.value,
	context: context.value,
	update,
	rotation: paged?.rotation,
	data: paged?.data,
}));
</script>

<template>
	<div class="flex flex-col gap-6">
		<div v-for="card in cards" :key="card.card" :data-settings-card="card.card">
			<ScreenSettingsSection
				:id="`${mode}:${card.card}`"
				:title="card.title"
				:collapsible="COLLAPSIBLE.has(card.card)"
				:summary="summaryOf(card)"
			>
				<!-- A group's fields under its heading, split from what precedes them. -->
				<section
					v-for="(section, index) in card.sections"
					:key="section.group?.id ?? 'ungrouped'"
					:role="section.group && !isRow(section) ? 'group' : undefined"
					:aria-labelledby="section.group && !isRow(section) ? headingId(card.card, section.group.id) : undefined"
					:data-settings-section="section.group?.id"
					class="flex flex-col gap-4"
				>
					<USeparator v-if="section.group && index > 0" />
					<!-- A group laid out as a row: its title names one row holding each field's control. -->
					<div
						v-if="section.group && isRow(section)"
						role="group"
						:aria-label="section.group.title"
						:data-settings-row="section.group.id"
					>
						<ScreenSettingsField :label="section.group.title" :description="rowDescription(section)">
							<div class="flex flex-wrap items-center gap-4">
								<template v-for="row in section.rows" :key="row.key">
									<div v-if="row.kind === 'field'" :data-settings-field="row.key">
										<ScreenModeSettingsField
											:entry="row.entry"
											:event-id="eventId"
											inline
											@update="updateField(row.entry, $event)"
										/>
									</div>
								</template>
							</div>
						</ScreenSettingsField>
					</div>
					<template v-else>
						<template v-if="section.group">
							<ScreenSettingsSubheading :id="headingId(card.card, section.group.id)">
								{{ section.group.title }}
							</ScreenSettingsSubheading>
							<div
								v-if="$slots[`before:${section.group.id}`]"
								:data-settings-group-slot="`before:${section.group.id}`"
							>
								<slot :name="`before:${section.group.id}`" v-bind="slotProps" :fields="[]" />
							</div>
						</template>
						<template v-for="row in section.rows" :key="row.key">
							<div v-if="row.kind === 'field'" :data-settings-field="row.key">
								<ScreenModeSettingsField
									:entry="row.entry"
									:event-id="eventId"
									@update="updateField(row.entry, $event)"
								/>
							</div>
							<div
								v-else
								:data-settings-slot="row.slot"
								:data-settings-fields="slotFieldKeys(row.fields)"
							>
								<slot :name="row.slot" v-bind="slotProps" :fields="row.fields">
									<ScreenPageSelection
										v-if="row.slot === 'page-rotation' && paged"
										:rotation="paged.rotation"
										:loading="paged.data.loading.value"
										:counting="!paged.data.answered.value"
									/>
									<template v-else-if="row.slot === 'columns'">
										<ScreenSettingsField
											v-for="entry in row.fields"
											:key="entry.path.join('.')"
											:label="fieldLabel(entry)"
											:description="fieldDescription(entry)"
											stacked
										>
											<ScreenColumnVisibilityList
												:columns="columnsOf(entry)"
												:labels="columnLabels(entry)"
												@update="updateColumns(entry, $event)"
											/>
										</ScreenSettingsField>
									</template>
								</slot>
							</div>
						</template>
					</template>
					<slot
						v-if="$slots[afterSlot(card.card, section.group?.id)]"
						:name="afterSlot(card.card, section.group?.id)"
						v-bind="slotProps"
						:fields="[]"
					/>
				</section>

				<ScreenSettingsLook
					v-if="card.looks.length > 0"
					:id="`${mode}:${card.card}:look`"
					:event-id="eventId"
					:looks="card.looks"
				/>
			</ScreenSettingsSection>
		</div>
	</div>
</template>
