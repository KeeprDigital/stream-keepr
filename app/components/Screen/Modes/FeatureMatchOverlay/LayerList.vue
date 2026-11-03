<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { GraphicItemPlacementRefusal } from '~~/shared/modules/graphics';
import type { GraphicItemConfig, GraphicItemKind } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';
import type { FeatureMatchLayoutEditorLayer } from '~/modules/feature-match-overlay/editorSelection';
import type { LayerDrop } from '~/modules/feature-match-overlay/layerDrag';
import { FEATURE_MATCH_SOURCE_ITEM_ICON } from '~~/shared/featureMatchSourceItems';
import {
	FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
	graphicGroupChildDefinitionsForHost,
	graphicItemDefinitionsForHost,
	graphicItemIcon,
	graphicItemKindLabel,
} from '~~/shared/modules/graphics';
import { editorSelectionKey } from '~/modules/feature-match-overlay/editorSelection';
import { layerDropAt, layerGroupMoves } from '~/modules/feature-match-overlay/layerDrag';
import { isLayerSelected } from '~/modules/feature-match-overlay/layerSelection';
import { isSelectionToggle } from '~/modules/graphics/selection';

/**
 * The Feature Match Layout's one layer list: every Graphic Item, every Source
 * Item, and the canvas, front to back — the order they composite in.
 *
 * The composition is mounted above the Frame and the Source Items as one layer,
 * so Graphic Items always sit in front of Source Items and the canvas is always
 * at the back. Each section reorders within itself; nothing here offers to move a
 * Source Item in front of a Graphic Item, because nothing renders one there.
 *
 * Front at the top, so the arrow pointing up moves a layer toward the front.
 *
 * Shift-click selects the run of rows from the one chosen last, and ⌘- or
 * Ctrl-click adds or takes out one row (#740). A selected row's menu acts on
 * every selected layer.
 *
 * A row drags within its section, into a Graphic Group or out of one, as one
 * undo step; Escape cancels, and a drop that is refused says why (#741). The
 * arrows and the row menu's "Move to group" do the same from the keyboard.
 *
 * Without the Graphics Authoring Lease the list still selects, and offers no
 * edit at all (#738).
 */
const props = defineProps<{
	layout: FeatureMatchLayoutConfig;
	editor: FeatureMatchLayoutEditor;
	canvasWidth: number;
	canvasHeight: number;
}>();

interface LayerRow {
	key: string;
	target: FeatureMatchLayoutEditorLayer;
	label: string;
	kind: string;
	icon: string;
	depth: 0 | 1;
	visible: boolean;
	canMoveForward: boolean;
	canMoveBackward: boolean;
}

function itemRow(item: GraphicItemConfig, index: number, siblingCount: number, depth: 0 | 1): LayerRow {
	const target: FeatureMatchLayoutEditorLayer = { type: 'item', itemId: item.id };
	return {
		key: editorSelectionKey(target),
		target,
		label: item.label,
		kind: graphicItemKindLabel(item.type),
		icon: graphicItemIcon(item.type),
		depth,
		visible: item.visible !== false,
		canMoveForward: index < siblingCount - 1,
		canMoveBackward: index > 0,
	};
}

/** Front to back: the last-composited item first, each group's children beneath it. */
const itemRows = computed<LayerRow[]>(() => {
	const items = props.layout.composition.items;
	const rows: LayerRow[] = [];
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index]!;
		rows.push(itemRow(item, index, items.length, 0));
		if (item.type !== 'group')
			continue;
		for (let childIndex = item.children.length - 1; childIndex >= 0; childIndex -= 1)
			rows.push(itemRow(item.children[childIndex] as GraphicItemConfig, childIndex, item.children.length, 1));
	}
	return rows;
});

const sourceRows = computed<LayerRow[]>(() => {
	const sources = props.layout.sources;
	return sources.map((item, index) => {
		const target: FeatureMatchLayoutEditorLayer = { type: 'source', itemId: item.id };
		return {
			key: editorSelectionKey(target),
			target,
			label: item.label,
			kind: 'Source',
			icon: FEATURE_MATCH_SOURCE_ITEM_ICON,
			depth: 0 as const,
			visible: item.visible !== false,
			canMoveForward: index < sources.length - 1,
			canMoveBackward: index > 0,
		};
	}).reverse();
});

const sections = computed(() => [
	{
		key: 'items',
		title: 'Graphic Items',
		rows: itemRows.value,
		empty: 'No Graphic Items yet',
	},
	{
		key: 'sources',
		title: 'Sources',
		rows: sourceRows.value,
		empty: 'No Source Items yet',
	},
]);

/** The one selected layer's key, or the canvas's with none or several. */
const selectedKey = computed(() => editorSelectionKey(props.editor.selection.value));
const writable = computed(() => props.editor.writable.value);
const severalSelected = computed(() => props.editor.layers.value.length > 1);
const canvasSelected = computed(() => props.editor.layers.value.length === 0);

function isSelected(row: LayerRow) {
	return isLayerSelected(props.editor.layers.value, row.target);
}

/** A plain click selects the row alone; Shift selects a run, and ⌘ or Ctrl adds or takes out one. */
function clickRow(event: MouseEvent, row: LayerRow) {
	if (isSelectionToggle(event))
		props.editor.toggleSelect(row.target);
	else if (event.shiftKey)
		props.editor.extendSelect(row.target);
	else
		props.editor.select(row.target);
}

/* ── Add menu ─────────────────────────────────── */

const addMenu = computed<DropdownMenuItem[][]>(() => {
	const items: DropdownMenuItem[][] = [
		graphicItemDefinitionsForHost(FEATURE_MATCH_OVERLAY_HOST_CONTRACT).map(definition => ({
			label: definition.label,
			icon: definition.icon,
			onSelect: () => props.editor.addItem(definition.kind),
		})),
		[
			{
				label: 'Source Item',
				icon: FEATURE_MATCH_SOURCE_ITEM_ICON,
				onSelect: () => props.editor.addSource(),
			},
		],
	];
	const group = props.editor.selectedGroup.value;
	if (group) {
		items.push([
			{ type: 'label', label: `Add to ${group.label}` },
			...graphicGroupChildDefinitionsForHost(FEATURE_MATCH_OVERLAY_HOST_CONTRACT).map(definition => ({
				label: definition.label,
				icon: definition.icon,
				onSelect: () => props.editor.addGroupChild(definition.kind as Exclude<GraphicItemKind, 'group'>),
			})),
		]);
	}
	return items;
});

/**
 * What a row's own controls act on: a selected row among several speaks for the
 * whole selection, as the keyboard does, and any other row for itself.
 */
function rowTarget(row: LayerRow): FeatureMatchLayoutEditorLayer | undefined {
	return severalSelected.value && isSelected(row)
		? undefined
		: row.target;
}

const REFUSALS: Record<GraphicItemPlacementRefusal, string> = {
	'rotated-into-arranged-group': 'A rotated layer can\'t go into a row or column group',
	'group-into-group': 'A group can\'t go into another group',
	'not-a-group': 'Only a group takes layers in',
};

/** "Move to group": the keyboard's way into or out of a Graphic Group (#741). */
function moveToGroupMenu(row: LayerRow): DropdownMenuItem[][] {
	const moves = layerGroupMoves(props.layout, row.target);
	if (moves.length === 0)
		return [];
	return [
		[
			{
				label: 'Move to group',
				icon: 'i-lucide-folder-input',
				children: moves.map(move => ({
					label: move.label,
					disabled: move.refusal !== null,
					description: move.refusal
						? REFUSALS[move.refusal]
						: undefined,
					onSelect: () => props.editor.place(row.target, move.place),
				})),
			},
		],
	];
}

function rowMenu(row: LayerRow): DropdownMenuItem[][] {
	const target = rowTarget(row);
	return [
		[
			{
				label: 'Duplicate',
				icon: 'i-lucide-copy',
				kbds: ['meta', 'd'],
				onSelect: () => props.editor.duplicate(target),
			},
		],
		[
			{
				label: 'Bring to front',
				icon: 'i-lucide-bring-to-front',
				disabled: !row.canMoveForward,
				onSelect: () => props.editor.moveToEdge(row.target, 'front'),
			},
			{
				label: 'Send to back',
				icon: 'i-lucide-send-to-back',
				disabled: !row.canMoveBackward,
				onSelect: () => props.editor.moveToEdge(row.target, 'back'),
			},
		],
		...moveToGroupMenu(row),
		[
			{
				label: 'Delete',
				icon: 'i-lucide-trash-2',
				color: 'error',
				kbds: ['delete'],
				onSelect: () => props.editor.remove(target),
			},
		],
	];
}

/* ── Keeping the selection in view ─────────────── */

const rowElements = new Map<string, HTMLElement>();

function setRowElement(key: string, element: unknown) {
	if (element instanceof HTMLElement)
		rowElements.set(key, element);
	else
		rowElements.delete(key);
}

/** The row chosen last, or the canvas with none. */
const revealKey = computed(() => {
	const anchor = props.editor.anchor.value;
	return anchor
		? editorSelectionKey(anchor)
		: 'canvas';
});

/**
 * Scroll the selected row into view within the list's own scroller only.
 *
 * Not `scrollIntoView`, which scrolls every scrollable ancestor — the page
 * included — and so moved the whole editor whenever something was selected.
 */
function revealSelectedRow() {
	const row = rowElements.get(revealKey.value);
	if (!row)
		return;
	let scroller = row.parentElement;
	while (scroller && scroller !== document.body) {
		const overflow = getComputedStyle(scroller).overflowY;
		if ((overflow === 'auto' || overflow === 'scroll') && scroller.scrollHeight > scroller.clientHeight)
			break;
		scroller = scroller.parentElement;
	}
	if (!scroller || scroller === document.body)
		return;
	const rowBox = row.getBoundingClientRect();
	const scrollerBox = scroller.getBoundingClientRect();
	if (rowBox.top < scrollerBox.top)
		scroller.scrollTop -= scrollerBox.top - rowBox.top + 8;
	else if (rowBox.bottom > scrollerBox.bottom)
		scroller.scrollTop += rowBox.bottom - scrollerBox.bottom + 8;
}

watch(revealKey, () => {
	void nextTick(revealSelectedRow);
});

/* ── Renaming in place ─────────────────────────── */

/** The row whose name is an input, and the name typed into it so far. */
const renaming = shallowRef<LayerRow | null>(null);
const draft = ref('');
let renameInput: HTMLInputElement | null = null;

function setRenameInput(element: unknown) {
	renameInput = element instanceof HTMLInputElement
		? element
		: null;
}

function startRename(row: LayerRow) {
	props.editor.select(row.target);
	if (!writable.value)
		return;
	renaming.value = row;
	draft.value = row.label;
	void nextTick(() => {
		renameInput?.focus();
		renameInput?.select();
	});
}

/** End the rename, the row a button again. Answers the row it ended, if any. */
function endRename(): LayerRow | null {
	const row = renaming.value;
	renaming.value = null;
	return row;
}

function refocusRow(row: LayerRow) {
	void nextTick(() => {
		rowElements.get(row.key)?.querySelector<HTMLElement>('[data-testid="layer-select"]')?.focus();
	});
}

/**
 * Write the typed name. After Enter focus goes back to the row; after a blur it
 * stays wherever the author went.
 */
function commitRename(options: { refocus: boolean }) {
	const row = endRename();
	if (!row)
		return;
	props.editor.rename(row.target, draft.value);
	if (options.refocus)
		refocusRow(row);
}

function cancelRename() {
	const row = endRename();
	if (row)
		refocusRow(row);
}

/** A row that leaves the list mid-rename takes its rename with it. */
watch(() => [
	...itemRows.value,
	...sourceRows.value,
].map(row => row.key), (keys) => {
	if (renaming.value && !keys.includes(renaming.value.key))
		endRename();
});

/**
 * Rows are buttons, so Enter selects; Enter on the row already selected, or F2,
 * renames it. A held Enter repeats, and its repeats are not a second press.
 */
function rowKeydown(event: KeyboardEvent, row: LayerRow) {
	if (event.repeat)
		return;
	if (event.key === 'F2' || (event.key === 'Enter' && row.key === selectedKey.value)) {
		event.preventDefault();
		startRename(row);
	}
}

/**
 * Every key typed into the name stays there. The editor's canvas shortcuts
 * already pass over a key typed into an input, so this is belt and braces:
 * Escape here must cancel the rename, never also select the canvas.
 *
 * The Enter that confirms an input method's composition is not the author's.
 */
function renameKeydown(event: KeyboardEvent) {
	event.stopPropagation();
	if (event.isComposing)
		return;
	if (event.key === 'Enter') {
		event.preventDefault();
		commitRename({ refocus: true });
	}
	else if (event.key === 'Escape') {
		event.preventDefault();
		cancelRename();
	}
}

/* ── Dragging a row (#741) ─────────────────────── */

/** The row being dragged, alone: v1 drags a single row. */
const dragged = shallowRef<LayerRow | null>(null);
/** Where the row would land, as the last dragover found it. */
const drop = shallowRef<LayerDrop | null>(null);

function startDrag(event: DragEvent, row: LayerRow) {
	if (!writable.value || renaming.value) {
		event.preventDefault();
		return;
	}
	dragged.value = row;
	props.editor.select(row.target);
	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', row.label);
	}
}

/** Only a drop that can land is accepted, so a refused one shows the browser's no-drop cursor. */
function dragOver(event: DragEvent, row: LayerRow) {
	const from = dragged.value;
	if (!from)
		return;
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const fraction = box.height > 0
		? (event.clientY - box.top) / box.height
		: 0;
	drop.value = layerDropAt(props.layout, from.target, row.target, fraction);
	if (drop.value && !drop.value.refusal) {
		event.preventDefault();
		if (event.dataTransfer)
			event.dataTransfer.dropEffect = 'move';
	}
}

/** Escape, or a drop anywhere else, ends the drag with a dragend and no drop. */
function endDrag() {
	dragged.value = null;
	drop.value = null;
}

function dropOn(event: DragEvent) {
	const from = dragged.value;
	const landing = drop.value;
	endDrag();
	if (!from || !landing || landing.refusal)
		return;
	event.preventDefault();
	props.editor.place(from.target, landing.place);
}

/** Leaving the list for somewhere else hides the indicator. */
function leaveList(event: DragEvent) {
	const into = event.relatedTarget;
	if (!(into instanceof Node) || !(event.currentTarget as HTMLElement).contains(into))
		drop.value = null;
}

const dropRefusal = computed(() => drop.value?.refusal
	? REFUSALS[drop.value.refusal]
	: null);

/**
 * The drop indicator a row shows: a line at an edge, a ring round a group taking
 * the layer in, and a line reaching out to the group's own indent below its last
 * child. Red where the drop is refused. Whole class names, for Tailwind to find.
 */
const DROP_INDICATOR_CLASSES: Record<LayerDrop['edge'], { open: string; refused: string }> = {
	'top': {
		open: 'shadow-[inset_0_2px_0_var(--ui-primary)]',
		refused: 'shadow-[inset_0_2px_0_var(--ui-error)]',
	},
	'bottom': {
		open: 'shadow-[inset_0_-2px_0_var(--ui-primary)]',
		refused: 'shadow-[inset_0_-2px_0_var(--ui-error)]',
	},
	'below-group': {
		open: 'relative after:absolute after:-left-4 after:right-0 after:bottom-0 after:h-0.5 after:bg-primary',
		refused: 'relative after:absolute after:-left-4 after:right-0 after:bottom-0 after:h-0.5 after:bg-error',
	},
	'inside': {
		open: 'ring-2 ring-primary',
		refused: 'ring-2 ring-error',
	},
};

function dropIndicatorClass(row: LayerRow) {
	const landing = drop.value;
	if (landing?.row !== row.key)
		return '';
	const classes = DROP_INDICATOR_CLASSES[landing.edge];
	return landing.refusal
		? classes.refused
		: classes.open;
}
</script>

<template>
	<div class="space-y-3" data-testid="feature-match-layer-list" @dragleave="leaveList">
		<div class="flex items-center justify-between gap-2">
			<div>
				<p class="text-sm font-semibold">
					Layers
				</p>
				<p class="text-xs text-muted">
					Front at the top
				</p>
			</div>
			<UDropdownMenu :items="writable ? addMenu : []" :content="{ align: 'end' }">
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-plus"
					trailing-icon="i-lucide-chevron-down"
					:disabled="!writable"
					data-testid="layer-add"
				>
					Add
				</UButton>
			</UDropdownMenu>
		</div>

		<p
			v-if="dropRefusal"
			role="status"
			class="rounded-md bg-error/10 px-2 py-1 text-xs text-error"
			data-testid="layer-drop-refusal"
		>
			{{ dropRefusal }}
		</p>

		<template v-for="section in sections" :key="section.key">
			<div class="space-y-0.5">
				<p :id="`layer-section-${section.key}`" class="px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-dimmed">
					{{ section.title }}
				</p>
				<p v-if="section.rows.length === 0" class="px-2 py-1.5 text-xs text-muted">
					{{ section.empty }}
				</p>
				<!-- A grid, so each row can say whether it is selected while holding its own controls. -->
				<div
					v-else
					role="grid"
					aria-multiselectable="true"
					:aria-labelledby="`layer-section-${section.key}`"
					class="space-y-0.5"
				>
					<div
						v-for="row in section.rows"
						:key="row.key"
						:ref="element => setRowElement(row.key, element)"
						role="row"
						:aria-selected="isSelected(row)"
						class="group flex items-center gap-1 rounded-md border pr-1 transition"
						:class="[
							isSelected(row) ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-elevated/60',
							row.depth === 1 ? 'ml-4' : '',
							row.visible && dragged?.key !== row.key ? '' : 'opacity-60',
							dropIndicatorClass(row),
						]"
						:draggable="writable && renaming?.key !== row.key"
						:data-dragging="dragged?.key === row.key || undefined"
						:data-drop-edge="drop?.row === row.key ? drop.edge : undefined"
						:data-drop-refused="drop?.row === row.key && drop.refusal ? true : undefined"
						:data-layer-key="row.key"
						data-testid="layer-row"
						@dragstart="startDrag($event, row)"
						@dragover="dragOver($event, row)"
						@drop="dropOn($event)"
						@dragend="endDrag"
					>
						<div role="gridcell" class="flex min-w-0 flex-1">
							<div
								v-if="renaming?.key === row.key"
								class="flex min-w-0 flex-1 items-center gap-2 py-1 pl-2"
							>
								<UIcon :name="row.icon" class="size-4 shrink-0 text-muted" />
								<input
									:ref="setRenameInput"
									v-model="draft"
									type="text"
									class="min-w-0 flex-1 rounded-sm bg-default px-1 py-0.5 text-sm outline-none ring-1 ring-primary"
									:aria-label="`Rename ${row.label}`"
									data-testid="layer-rename"
									@keydown="renameKeydown"
									@blur="commitRename({ refocus: false })"
								>
							</div>
							<button
								v-else
								type="button"
								class="flex min-w-0 flex-1 select-none items-center gap-2 py-1.5 pl-2 text-left"
								:title="writable ? `${row.label} · ${row.kind} — double-click or F2 to rename` : `${row.label} · ${row.kind}`"
								data-testid="layer-select"
								@click="clickRow($event, row)"
								@dblclick="startRename(row)"
								@keydown="rowKeydown($event, row)"
							>
								<UIcon :name="row.icon" class="size-4 shrink-0 text-muted" />
								<span class="min-w-0 flex-1 truncate text-sm">{{ row.label }}</span>
							</button>
						</div>
						<div
							v-if="writable"
							role="gridcell"
							class="shrink-0 items-center"
							:class="isSelected(row) ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'"
						>
							<UButton
								size="xs"
								variant="ghost"
								color="neutral"
								icon="i-lucide-arrow-up"
								:disabled="!row.canMoveForward"
								:aria-label="`Move ${row.label} forward`"
								data-testid="layer-forward"
								@click="editor.move(row.target, 1)"
							/>
							<UButton
								size="xs"
								variant="ghost"
								color="neutral"
								icon="i-lucide-arrow-down"
								:disabled="!row.canMoveBackward"
								:aria-label="`Move ${row.label} backward`"
								data-testid="layer-backward"
								@click="editor.move(row.target, -1)"
							/>
							<UDropdownMenu :items="rowMenu(row)" :content="{ align: 'end' }">
								<UButton
									size="xs"
									variant="ghost"
									color="neutral"
									icon="i-lucide-ellipsis"
									:aria-label="`More actions for ${row.label}`"
									data-testid="layer-more"
								/>
							</UDropdownMenu>
						</div>
						<div role="gridcell" class="shrink-0">
							<UButton
								size="xs"
								variant="ghost"
								color="neutral"
								:icon="row.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'"
								:aria-label="row.visible ? `Hide ${row.label}` : `Show ${row.label}`"
								:aria-pressed="!row.visible"
								:disabled="!writable"
								data-testid="layer-visibility"
								@click="editor.toggleVisible(rowTarget(row))"
							/>
						</div>
					</div>
				</div>
			</div>
		</template>

		<div class="space-y-0.5">
			<p class="px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-dimmed">
				Background
			</p>
			<button
				:ref="element => setRowElement('canvas', element)"
				type="button"
				class="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition"
				:class="canvasSelected ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-elevated/60'"
				:aria-current="canvasSelected ? 'true' : undefined"
				data-testid="layer-canvas"
				@click="editor.select({ type: 'canvas' })"
			>
				<UIcon name="i-lucide-panels-top-left" class="size-4 shrink-0 text-muted" />
				<span class="min-w-0 flex-1 truncate text-sm">Canvas</span>
				<span class="shrink-0 text-[0.6875rem] text-dimmed">{{ canvasWidth }}×{{ canvasHeight }}</span>
			</button>
		</div>
	</div>
</template>
