<script setup lang="ts">
import type {
	MetagameArchetypeColumnKey,
	MetagameCardColumnKey,
} from '~~/shared/types/enums';
import type {
	ArchetypeBreakdownEntry,
	CardBreakdownEntry,
} from '~~/shared/types/metagame';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import { useElementSize } from '@vueuse/core';
import { getCardTypeDisplayLabel } from '~~/shared/utils/metagame';

interface TableColumnDefinition<Key extends string> {
	key: Key;
	label: string;
	width: string;
	headerClass?: string;
	cellClass?: string;
}

const { screen } = useScreenContext();

const {
	config,
	error,
	isEmpty,
	headerText,
	pageData,
	currentPage,
	totalPages,
} = useMetagameModeData();

const screenConfig = computed<Partial<ScreenConfig>>(() => (screen.value?.screenConfig ?? {}) as Partial<ScreenConfig>);
const primaryTextStyle = computed(() => {
	return screenConfig.value.primaryTextColor
		? { color: screenConfig.value.primaryTextColor }
		: {};
});
const secondaryTextStyle = computed(() => {
	if (screenConfig.value.secondaryTextColor) {
		return { color: screenConfig.value.secondaryTextColor };
	}

	return { opacity: '0.75' };
});

const archetypeColumnDefinitions: Record<MetagameArchetypeColumnKey, TableColumnDefinition<MetagameArchetypeColumnKey>> = {
	archetype: { key: 'archetype', label: 'Archetype', width: 'minmax(0, 2.4fr)', cellClass: 'is-name' },
	count: { key: 'count', label: 'Count', width: '5rem', headerClass: 'is-numeric', cellClass: 'is-numeric is-primary-metric' },
	metaShare: { key: 'metaShare', label: 'Share', width: '7rem', headerClass: 'is-numeric', cellClass: 'is-numeric is-primary-metric' },
	winRate: { key: 'winRate', label: 'Win Rate', width: '7rem', headerClass: 'is-numeric', cellClass: 'is-numeric' },
	avgPlace: { key: 'avgPlace', label: 'Avg Place', width: '7rem', headerClass: 'is-numeric', cellClass: 'is-numeric' },
	colors: { key: 'colors', label: 'Colors', width: '6rem', headerClass: 'is-center', cellClass: 'is-center' },
};

const cardColumnDefinitions: Record<MetagameCardColumnKey, TableColumnDefinition<MetagameCardColumnKey>> = {
	card: { key: 'card', label: 'Card', width: 'minmax(0, 2.2fr)', cellClass: 'is-name' },
	manaCost: { key: 'manaCost', label: 'Cost', width: '7rem', headerClass: 'is-center', cellClass: 'is-center' },
	type: { key: 'type', label: 'Type', width: '8rem' },
	inclusionRate: { key: 'inclusionRate', label: 'Inclusion', width: '7rem', headerClass: 'is-numeric', cellClass: 'is-numeric is-primary-metric' },
	avgCopies: { key: 'avgCopies', label: 'Avg Copies', width: '7rem', headerClass: 'is-numeric', cellClass: 'is-numeric is-primary-metric' },
	totalCopies: { key: 'totalCopies', label: 'Total Copies', width: '7rem', headerClass: 'is-numeric', cellClass: 'is-numeric' },
	deckCount: { key: 'deckCount', label: 'Decks', width: '6rem', headerClass: 'is-numeric', cellClass: 'is-numeric' },
	mainboardCount: { key: 'mainboardCount', label: 'Main', width: '6rem', headerClass: 'is-numeric', cellClass: 'is-numeric' },
	sideboardCount: { key: 'sideboardCount', label: 'Side', width: '6rem', headerClass: 'is-numeric', cellClass: 'is-numeric' },
};

const visibleArchetypeColumns = computed(() =>
	config.value.archetypeColumns
		.filter(column => column.visible)
		.map(column => archetypeColumnDefinitions[column.key]),
);

const visibleCardColumns = computed(() =>
	config.value.cardColumns
		.filter(column => column.visible)
		.map(column => cardColumnDefinitions[column.key]),
);

const activeColumns = computed(() =>
	config.value.viewMode === 'cards'
		? visibleCardColumns.value
		: visibleArchetypeColumns.value,
);

const gridTemplateColumns = computed(() => activeColumns.value.map(column => column.width).join(' '));

const gridStyle = computed(() => ({
	gridTemplateColumns: gridTemplateColumns.value,
}));

const tableRef = useTemplateRef<HTMLElement>('tableRef');
const { height: tableHeight } = useElementSize(tableRef);
const pageInsetY = computed(() => screenConfig.value.paddingY ?? 0);

const rowLayoutStyle = computed(() => {
	const rowCount = Math.max(config.value.pageSize ?? pageData.value.length ?? 1, 1);
	const baseRowHeight = 44;
	const columnHeaderHeight = 38;
	const availableHeight = tableHeight.value > 0
		? tableHeight.value - columnHeaderHeight
		: rowCount * baseRowHeight;
	const usableHeight = Math.max(availableHeight - pageInsetY.value, rowCount * 24);
	const rowHeight = usableHeight / rowCount;
	const primaryFontSize = Math.max(14, 14 + ((rowHeight - 36) * 0.16));
	const secondaryFontSize = Math.max(12, primaryFontSize * 0.84);
	const paddingY = Math.max(4, rowHeight * 0.12);
	const paddingX = Math.max(10, primaryFontSize * 0.75);

	return {
		'--metagame-row-height': `${rowHeight}px`,
		'--metagame-row-font-size': `${primaryFontSize}px`,
		'--metagame-row-secondary-font-size': `${secondaryFontSize}px`,
		'--metagame-row-padding-y': `${paddingY}px`,
		'--metagame-row-padding-x': `${paddingX}px`,
	};
});

const contentStyle = computed(() => ({
	width: '100%',
	maxWidth: config.value.maxTableWidth ? `${config.value.maxTableWidth}px` : undefined,
	marginInline: config.value.maxTableWidth ? 'auto' : undefined,
}));

const displayStyle = computed(() => ({
	'--metagame-primary-text': screenConfig.value.primaryTextColor ?? '#ffffff',
	'--metagame-secondary-text': screenConfig.value.secondaryTextColor ?? 'rgba(255, 255, 255, 0.72)',
	'--broadcast-table-primary-text': screenConfig.value.primaryTextColor ?? '#ffffff',
	'--broadcast-table-secondary-text': screenConfig.value.secondaryTextColor ?? 'rgba(255, 255, 255, 0.72)',
}));

function isArchetypeEntry(entry: unknown): entry is ArchetypeBreakdownEntry {
	return !!entry && typeof entry === 'object' && 'name' in entry && 'metaShare' in entry && 'count' in entry;
}

function isCardEntry(entry: unknown): entry is CardBreakdownEntry {
	return !!entry && typeof entry === 'object' && 'inclusionRate' in entry && 'avgCopies' in entry;
}

function formatPercent(value: number | null): string {
	if (value == null) {
		return '-';
	}

	return `${value}%`;
}

function formatNumber(value: number | null, options: Intl.NumberFormatOptions = {}): string {
	if (value == null) {
		return '-';
	}

	return new Intl.NumberFormat(undefined, {
		maximumFractionDigits: 2,
		...options,
	}).format(value);
}

function formatArchetypeCell(entry: ArchetypeBreakdownEntry, key: MetagameArchetypeColumnKey): string {
	switch (key) {
		case 'archetype':
			return entry.name;
		case 'count':
			return formatNumber(entry.count, { maximumFractionDigits: 0 });
		case 'metaShare':
			return formatPercent(entry.metaShare);
		case 'winRate':
			return formatPercent(entry.winRate);
		case 'avgPlace':
			return formatNumber(entry.avgPosition, { maximumFractionDigits: 1 });
		case 'colors':
			return entry.colors ?? '-';
	}
}

function formatCardCell(entry: CardBreakdownEntry, key: MetagameCardColumnKey): string {
	switch (key) {
		case 'card':
			return entry.name;
		case 'manaCost':
			return entry.manaCost ?? '-';
		case 'type':
			return getCardTypeDisplayLabel(entry.cardType, { nonbasicLandLabel: true });
		case 'inclusionRate':
			return formatPercent(entry.inclusionRate);
		case 'avgCopies':
			return formatNumber(entry.avgCopies);
		case 'totalCopies':
			return formatNumber(entry.totalCopies, { maximumFractionDigits: 0 });
		case 'deckCount':
			return formatNumber(entry.deckCount, { maximumFractionDigits: 0 });
		case 'mainboardCount':
			return formatNumber(entry.mainboardCount, { maximumFractionDigits: 0 });
		case 'sideboardCount':
			return formatNumber(entry.sideboardCount, { maximumFractionDigits: 0 });
	}
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="metagame-display broadcast-table-display flex flex-col h-full w-full" :style="displayStyle">
			<div data-testid="metagame-content" class="metagame-content broadcast-table-content flex flex-col h-full w-full" :style="contentStyle">
				<div v-if="config.showHeader" class="metagame-title broadcast-table-title">
					<h2 :style="primaryTextStyle">
						{{ headerText }}
					</h2>
				</div>

				<div ref="tableRef" class="metagame-table broadcast-table-surface">
					<div class="metagame-header-row broadcast-table-header-row metagame-grid" :style="gridStyle" data-testid="metagame-header-row">
						<div
							v-for="column in activeColumns"
							:key="column.key"
							class="metagame-header-cell"
							:class="column.headerClass"
						>
							{{ column.label }}
						</div>
					</div>

					<TransitionGroup
						v-if="config.animateEntries"
						name="metagame-row"
						tag="div"
						class="metagame-rows"
						:style="rowLayoutStyle"
					>
						<div
							v-for="(entry, index) in pageData"
							:key="config.viewMode === 'cards' && isCardEntry(entry) ? entry.id : isArchetypeEntry(entry) ? entry.id : index"
							class="metagame-row broadcast-table-row metagame-grid"
							:style="{ ...gridStyle, '--row-index': index }"
							:data-testid="`metagame-row-${index}`"
						>
							<template v-if="config.viewMode === 'archetype' && isArchetypeEntry(entry)">
								<div
									v-for="column in visibleArchetypeColumns"
									:key="column.key"
									class="metagame-cell"
									:class="column.cellClass"
								>
									<template v-if="column.key === 'colors'">
										<MtgManaColorDisplay v-if="entry.colors" :colors="entry.colors" size="sm" />
										<span v-else class="text-secondary-tone">-</span>
									</template>
									<template v-else>
										{{ formatArchetypeCell(entry, column.key) }}
									</template>
								</div>
							</template>

							<template v-else-if="config.viewMode === 'cards' && isCardEntry(entry)">
								<div
									v-for="column in visibleCardColumns"
									:key="column.key"
									class="metagame-cell"
									:class="column.cellClass"
								>
									<template v-if="column.key === 'manaCost'">
										<MtgManaColorDisplay v-if="entry.manaCost" :mana-cost="entry.manaCost" size="xs" />
										<span v-else class="text-secondary-tone">-</span>
									</template>
									<template v-else>
										{{ formatCardCell(entry, column.key) }}
									</template>
								</div>
							</template>
						</div>
					</TransitionGroup>

					<div v-else class="metagame-rows" :style="rowLayoutStyle">
						<div
							v-for="(entry, index) in pageData"
							:key="config.viewMode === 'cards' && isCardEntry(entry) ? entry.id : isArchetypeEntry(entry) ? entry.id : index"
							class="metagame-row broadcast-table-row metagame-grid"
							:style="gridStyle"
						>
							<template v-if="config.viewMode === 'archetype' && isArchetypeEntry(entry)">
								<div
									v-for="column in visibleArchetypeColumns"
									:key="column.key"
									class="metagame-cell"
									:class="column.cellClass"
								>
									<template v-if="column.key === 'colors'">
										<MtgManaColorDisplay v-if="entry.colors" :colors="entry.colors" size="sm" />
										<span v-else class="text-secondary-tone">-</span>
									</template>
									<template v-else>
										{{ formatArchetypeCell(entry, column.key) }}
									</template>
								</div>
							</template>

							<template v-else-if="config.viewMode === 'cards' && isCardEntry(entry)">
								<div
									v-for="column in visibleCardColumns"
									:key="column.key"
									class="metagame-cell"
									:class="column.cellClass"
								>
									<template v-if="column.key === 'manaCost'">
										<MtgManaColorDisplay v-if="entry.manaCost" :mana-cost="entry.manaCost" size="xs" />
										<span v-else class="text-secondary-tone">-</span>
									</template>
									<template v-else>
										{{ formatCardCell(entry, column.key) }}
									</template>
								</div>
							</template>
						</div>
					</div>
				</div>

				<div v-if="totalPages > 1" class="metagame-page-indicator broadcast-table-page-indicator" :style="secondaryTextStyle">
					{{ currentPage }} / {{ totalPages }}
				</div>
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.metagame-display {
	color: var(--metagame-primary-text);
}

.metagame-table {
	width: 100%;
}

.metagame-grid {
	display: grid;
	align-items: center;
	gap: 0.75rem;
	width: 100%;
	box-sizing: border-box;
}

.metagame-header-row {
	padding: 0.75rem var(--metagame-row-padding-x, 1rem);
	border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	font-size: var(--metagame-row-secondary-font-size, 0.72rem);
	font-weight: 700;
	color: var(--metagame-secondary-text);
	flex-shrink: 0;
}

.metagame-header-cell,
.metagame-cell {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.metagame-row {
	height: var(--metagame-row-height, auto);
	padding: var(--metagame-row-padding-y, 0.625rem) var(--metagame-row-padding-x, 1rem);
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.metagame-row:last-child {
	border-bottom: none;
}

.metagame-cell {
	color: var(--metagame-secondary-text);
	font-size: var(--metagame-row-font-size, 1rem);
	line-height: 1.1;
}

.metagame-cell.is-name,
.metagame-cell.is-primary-metric,
.text-primary-tone {
	color: var(--metagame-primary-text);
}

.text-secondary-tone {
	color: var(--metagame-secondary-text);
}

.is-name {
	font-weight: 600;
}

.is-center {
	text-align: center;
	justify-self: center;
	width: 100%;
}

.is-numeric {
	text-align: right;
	font-family: var(--font-mono);
	font-variant-numeric: tabular-nums;
}

.metagame-rows {
	position: relative;
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.metagame-page-indicator {
	opacity: 0.9;
	flex-shrink: 0;
}

.metagame-row-enter-active {
	transition: all 0.4s ease;
	transition-delay: calc(var(--row-index) * 0.05s);
}

.metagame-row-enter-from {
	opacity: 0;
	transform: translateX(-20px);
}

.metagame-row-leave-active {
	transition: all 0.3s ease;
	position: absolute;
	left: 0;
	right: 0;
}

.metagame-row-leave-to {
	opacity: 0;
	transform: translateX(20px);
}

.metagame-row-move {
	transition: transform 0.4s ease;
}
</style>
