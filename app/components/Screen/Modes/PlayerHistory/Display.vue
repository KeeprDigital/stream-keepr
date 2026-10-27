<script setup lang="ts">
import type { PlayerHistoryColumnKey } from '~~/shared/types/enums';
import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import { formatGameScore } from '~~/shared/utils/matchFromPlayerSide';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const { config, error, isEmpty, headerText, pageData, player, formatOutcome } = usePlayerHistoryModeData();

const columnWidths: Record<PlayerHistoryColumnKey, string> = {
	round: 'minmax(10rem, 1fr)',
	opponent: 'minmax(16rem, 2fr)',
	table: 'minmax(7rem, auto)',
	outcome: 'minmax(8rem, auto)',
	opponentArchetype: 'minmax(12rem, 1.5fr)',
	gameScore: 'minmax(6rem, auto)',
};

const visibleColumns = computed(() => config.value.columns.filter(column => column.visible));
// A fact with its own column shows there rather than twice: the opponent's deck
// under their name, and the game score on the outcome badge.
const showsArchetypeColumn = computed(() => visibleColumns.value.some(column => column.key === 'opponentArchetype'));
const showsGameScoreColumn = computed(() => visibleColumns.value.some(column => column.key === 'gameScore'));
const gridStyle = computed(() => ({
	gridTemplateColumns: visibleColumns.value.map(column => columnWidths[column.key]).join(' '),
}));

const primaryTextStyle = {
	color: modeTokenVar('player-history', 'primary-text'),
};
const secondaryTextStyle = {
	color: modeTokenVar('player-history', 'secondary-text'),
};
const titleStyle = {
	...modeTypographyStyle('player-history', 'title-typography'),
	color: modeTokenVar('player-history', 'title-text'),
};
const titleDividerStyle = {
	borderBottomColor: modeTokenVar('player-history', 'title-divider'),
};
/** Over the shared subtitle's own face. */
const subtitleStyle = {
	...modeTypographyStyle('player-history', 'row-typography'),
	...secondaryTextStyle,
};
/** On each row too, over the shared row chrome's own line height. */
const rowStyle = {
	...modeTypographyStyle('player-history', 'row-typography'),
	borderBottomColor: modeTokenVar('player-history', 'row-divider'),
};
const surfaceStyle = {
	backgroundColor: modeTokenVar('player-history', 'surface'),
};

const outcomeColors: Record<PlayerMatchHistoryEntry['outcome'], string> = {
	win: modeTokenVar('player-history', 'outcome-win'),
	bye: modeTokenVar('player-history', 'outcome-win'),
	loss: modeTokenVar('player-history', 'outcome-loss'),
	draw: modeTokenVar('player-history', 'outcome-draw'),
	pending: modeTokenVar('player-history', 'outcome-pending'),
};

function outcomeStyle(outcome: PlayerMatchHistoryEntry['outcome']) {
	return {
		...modeTypographyStyle('player-history', 'outcome-typography'),
		color: outcomeColors[outcome],
	};
}

const inset = useScreenInset();
const rowLayoutStyle = useTableRowLayout(useTemplateRef<HTMLElement>('tableRef'), {
	density: 'roomy',
	prefix: 'history',
	rowCount: () => config.value.rowsPerPage ?? pageData.value.length,
	insetY: inset,
});

/** Set on the root, over the shared broadcast table chrome's own colour and face. */
const displayStyle = computed(() => ({
	...rowLayoutStyle.value,
	...modeTypographyStyle('player-history', 'row-typography'),
	color: modeTokenVar('player-history', 'primary-text'),
}));

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
		<div class="player-history-display broadcast-table-display flex flex-col h-full w-full" :style="displayStyle">
			<div v-if="config.showHeader" class="history-header broadcast-table-title" :style="titleDividerStyle">
				<h2 :style="titleStyle">
					{{ headerText }}
				</h2>
				<p v-if="player" class="broadcast-table-subtitle" :style="subtitleStyle">
					Record {{ player.wins ?? 0 }}-{{ player.losses ?? 0 }}{{ player.draws ? `-${player.draws}` : '' }}
					<span v-if="player.position"> · #{{ player.position }}</span>
				</p>
			</div>

			<div ref="tableRef" class="history-rows broadcast-table-surface" :style="surfaceStyle">
				<div
					v-for="row in pageData"
					:key="row.id"
					class="history-row broadcast-table-row"
					:style="[rowStyle, gridStyle]"
				>
					<template v-for="column in visibleColumns" :key="column.key">
						<div v-if="column.key === 'round'" class="round" :style="secondaryTextStyle">
							{{ row.roundName }}
						</div>
						<div v-else-if="column.key === 'opponent'" class="opponent" :style="primaryTextStyle">
							<div>vs {{ row.opponentName }}</div>
							<div v-if="row.opponentDeckName && !showsArchetypeColumn" class="opponent-deck" :style="secondaryTextStyle">
								<ScreenModesPlayerHistoryOpponentDeck :name="row.opponentDeckName" :colors="row.opponentDeckColors" />
							</div>
						</div>
						<div v-else-if="column.key === 'table'" class="table" :style="secondaryTextStyle">
							{{ row.tableNumber ? `Table ${row.tableNumber}` : '' }}
						</div>
						<div v-else-if="column.key === 'outcome'" class="outcome">
							<span class="outcome-badge" :data-outcome="row.outcome" :style="outcomeStyle(row.outcome)">
								<span class="outcome-label">{{ outcomeParts(row).label }}</span>
								<span v-if="outcomeParts(row).score && !showsGameScoreColumn" class="outcome-score">{{ outcomeParts(row).score }}</span>
							</span>
						</div>
						<div v-else-if="column.key === 'opponentArchetype'" class="opponent-archetype" :style="secondaryTextStyle">
							<ScreenModesPlayerHistoryOpponentDeck v-if="row.opponentDeckName" :name="row.opponentDeckName" :colors="row.opponentDeckColors" />
						</div>
						<div v-else-if="column.key === 'gameScore'" class="game-score" :style="primaryTextStyle">
							{{ formatGameScore(row) ?? '' }}
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
	border-bottom-style: solid;
	border-bottom-width: 1px;
	font-size: var(--history-row-font-size, 1.5rem);
}
.round,
.table {
	font-size: var(--history-row-secondary-font-size, 1rem);
	font-variant-numeric: tabular-nums;
}
.opponent {
	font-weight: bolder;
}
.game-score {
	font-variant-numeric: tabular-nums;
	text-align: right;
}
.opponent-deck {
	font-size: 0.72em;
	margin-top: 0.15rem;
}
.outcome {
	display: flex;
	justify-content: flex-end;
}
/* Tinted from its own colour, so a Theme's outcome colour reaches the whole badge. */
.outcome-badge {
	align-items: center;
	border: 1px solid currentColor;
	border-radius: 999px;
	background: color-mix(in srgb, currentColor 16%, transparent);
	box-shadow: inset 0 0 1.6rem color-mix(in srgb, currentColor 8%, transparent);
	display: inline-flex;
	font-size: var(--history-row-secondary-font-size, 1rem);
	font-variant-numeric: tabular-nums;
	gap: 0.45em;
	justify-content: center;
	min-width: 5.75em;
	padding: 0.42em 0.75em;
}
.outcome-score {
	border-left: 1px solid currentColor;
	padding-left: 0.45em;
}
</style>
