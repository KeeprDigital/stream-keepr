<script setup lang="ts">
import type { PlayerHistoryColumnKey } from '~~/shared/types/enums';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import { useElementSize } from '@vueuse/core';

const { screen } = useScreenContext();
const { config, error, isEmpty, headerText, pageData, player, formatOutcome } = usePlayerHistoryModeData();

const columnWidths: Record<PlayerHistoryColumnKey, string> = {
	round: 'minmax(10rem, 1fr)',
	opponent: 'minmax(16rem, 2fr)',
	table: 'minmax(7rem, auto)',
	outcome: 'minmax(8rem, auto)',
};

const visibleColumns = computed(() => config.value.columns.filter(column => column.visible));
const gridStyle = computed(() => ({
	gridTemplateColumns: visibleColumns.value.map(column => columnWidths[column.key]).join(' '),
}));

const screenConfig = computed<Partial<ScreenConfig>>(() => (screen.value?.screenConfig ?? {}) as Partial<ScreenConfig>);
const primaryTextStyle = computed(() => screenConfig.value.primaryTextColor ? { color: screenConfig.value.primaryTextColor } : {});
const secondaryTextStyle = computed(() => screenConfig.value.secondaryTextColor ? { color: screenConfig.value.secondaryTextColor } : { opacity: '0.75' });
const tableRef = useTemplateRef<HTMLElement>('tableRef');
const { height: tableHeight } = useElementSize(tableRef);
const pageInsetY = computed(() => screenConfig.value.paddingY ?? 0);

const rowLayoutStyle = computed(() => {
	const rowCount = Math.max(config.value.rowsPerPage ?? pageData.value.length ?? 1, 1);
	const baseRowHeight = 72;
	const availableHeight = tableHeight.value > 0 ? tableHeight.value : rowCount * baseRowHeight;
	const usableHeight = Math.max(availableHeight - pageInsetY.value, rowCount * 44);
	const rowHeight = usableHeight / rowCount;
	const primaryFontSize = Math.max(18, 18 + ((rowHeight - 56) * 0.2));
	const secondaryFontSize = Math.max(13, primaryFontSize * 0.72);

	return {
		'--history-row-height': `${rowHeight}px`,
		'--history-row-font-size': `${primaryFontSize}px`,
		'--history-row-secondary-font-size': `${secondaryFontSize}px`,
		'--broadcast-table-primary-text': screenConfig.value.primaryTextColor ?? '#ffffff',
		'--broadcast-table-secondary-text': screenConfig.value.secondaryTextColor ?? 'rgba(255, 255, 255, 0.72)',
	};
});

function outcomeClass(outcome: string) {
	return {
		'outcome-win': outcome === 'win' || outcome === 'bye',
		'outcome-loss': outcome === 'loss',
		'outcome-draw': outcome === 'draw',
		'outcome-pending': outcome === 'pending',
	};
}

function outcomeParts(row: PlayerMatchHistoryEntry) {
	const text = formatOutcome(row);
	const [label, ...scoreParts] = text.split(' ');

	return {
		label,
		score: scoreParts.join(' '),
	};
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="player-history-display broadcast-table-display flex flex-col h-full w-full" :style="rowLayoutStyle">
			<div v-if="config.showHeader" class="history-header broadcast-table-title">
				<h2 :style="primaryTextStyle">
					{{ headerText }}
				</h2>
				<p v-if="player" class="broadcast-table-subtitle" :style="secondaryTextStyle">
					Record {{ player.wins ?? 0 }}-{{ player.losses ?? 0 }}{{ player.draws ? `-${player.draws}` : '' }}
					<span v-if="player.position"> · #{{ player.position }}</span>
				</p>
			</div>

			<div ref="tableRef" class="history-rows broadcast-table-surface">
				<div
					v-for="row in pageData"
					:key="row.id"
					class="history-row broadcast-table-row"
					:style="gridStyle"
				>
					<template v-for="column in visibleColumns" :key="column.key">
						<div v-if="column.key === 'round'" class="round" :style="secondaryTextStyle">
							{{ row.roundName }}
						</div>
						<div v-else-if="column.key === 'opponent'" class="opponent" :style="primaryTextStyle">
							<div>vs {{ row.opponentName }}</div>
							<div v-if="row.opponentDeckName" class="opponent-deck" :style="secondaryTextStyle">
								{{ row.opponentDeckName }}
								<MtgManaColorDisplay
									v-if="row.opponentDeckColors"
									:colors="row.opponentDeckColors"
									size="sm"
									class="inline-flex ml-2 align-middle"
								/>
							</div>
						</div>
						<div v-else-if="column.key === 'table'" class="table" :style="secondaryTextStyle">
							{{ row.tableNumber ? `Table ${row.tableNumber}` : '' }}
						</div>
						<div v-else-if="column.key === 'outcome'" class="outcome">
							<span class="outcome-badge" :class="outcomeClass(row.outcome)">
								<span class="outcome-label">{{ outcomeParts(row).label }}</span>
								<span v-if="outcomeParts(row).score" class="outcome-score">{{ outcomeParts(row).score }}</span>
							</span>
						</div>
					</template>
				</div>
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.history-rows {
	display: flex;
	flex-direction: column;
	padding: 0 1rem;
}
.history-row {
	display: grid;
	gap: 1rem;
	align-items: center;
	height: var(--history-row-height, auto);
	padding: 0 0.5rem;
	font-size: var(--history-row-font-size, 1.5rem);
}
.round,
.table {
	font-family: var(--font-mono);
	font-size: var(--history-row-secondary-font-size, 1rem);
	font-variant-numeric: tabular-nums;
}
.opponent {
	font-weight: 800;
}
.opponent-deck {
	font-size: 0.72em;
	font-weight: 500;
	margin-top: 0.15rem;
}
.outcome {
	display: flex;
	justify-content: flex-end;
}
.outcome-badge {
	align-items: center;
	border: 1px solid currentColor;
	border-radius: 999px;
	display: inline-flex;
	font-family: var(--font-mono);
	font-size: var(--history-row-secondary-font-size, 1rem);
	font-variant-numeric: tabular-nums;
	font-weight: 900;
	gap: 0.45em;
	justify-content: center;
	letter-spacing: 0.06em;
	line-height: 1;
	min-width: 5.75em;
	padding: 0.42em 0.75em;
	text-transform: uppercase;
}
.outcome-label {
	font-family: var(--font-display);
}
.outcome-score {
	border-left: 1px solid currentColor;
	padding-left: 0.45em;
}
.outcome-win {
	background: rgba(34, 197, 94, 0.18);
	box-shadow: inset 0 0 1.6rem rgba(34, 197, 94, 0.1);
	color: #4ade80;
}
.outcome-loss {
	background: rgba(248, 113, 113, 0.16);
	box-shadow: inset 0 0 1.6rem rgba(248, 113, 113, 0.08);
	color: #f87171;
}
.outcome-draw {
	background: rgba(250, 204, 21, 0.16);
	box-shadow: inset 0 0 1.6rem rgba(250, 204, 21, 0.08);
	color: #facc15;
}
.outcome-pending {
	background: rgba(255, 255, 255, 0.08);
	color: rgba(255, 255, 255, 0.68);
}
</style>
