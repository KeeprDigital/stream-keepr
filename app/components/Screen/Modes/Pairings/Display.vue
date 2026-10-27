<script setup lang="ts">
import type { ScreenOutputMatchSide, ScreenOutputRoundMatch } from '~~/shared/types/screenOutputReads';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const { config, error, isEmpty, headerText, pageData, formatResult, winner } = usePairingsModeData();

const inset = useScreenInset();

const primaryTextStyle = {
	color: modeTokenVar('pairings', 'primary-text'),
};
const secondaryTextStyle = {
	color: modeTokenVar('pairings', 'secondary-text'),
};
const titleStyle = {
	...modeTypographyStyle('pairings', 'title-typography'),
	color: modeTokenVar('pairings', 'title-text'),
};
const titleDividerStyle = {
	borderBottomColor: modeTokenVar('pairings', 'title-divider'),
};
/** On each row too, over the shared row chrome's own line height. */
const rowStyle = {
	...modeTypographyStyle('pairings', 'row-typography'),
	borderBottomColor: modeTokenVar('pairings', 'row-divider'),
};
const surfaceStyle = {
	backgroundColor: modeTokenVar('pairings', 'surface'),
};

type ResultState = 'reported' | 'pending' | 'bye';

const resultColors: Record<ResultState, string> = {
	reported: modeTokenVar('pairings', 'result-reported'),
	pending: modeTokenVar('pairings', 'result-pending'),
	bye: modeTokenVar('pairings', 'result-bye'),
};

function resultState(row: ScreenOutputRoundMatch): ResultState {
	if (row.isBye)
		return 'bye';
	return row.hasResult ? 'reported' : 'pending';
}

function resultStyle(row: ScreenOutputRoundMatch) {
	return {
		...modeTypographyStyle('pairings', 'result-typography'),
		color: resultColors[resultState(row)],
	};
}

const rowLayoutStyle = useTableRowLayout(useTemplateRef<HTMLElement>('tableRef'), {
	density: 'roomy',
	prefix: 'pairings',
	rowCount: () => config.value.rowsPerPage ?? pageData.value.length,
	insetY: inset,
});

/** Set on the root, over the shared broadcast table chrome's own colour and face. */
const displayStyle = computed(() => ({
	...rowLayoutStyle.value,
	...modeTypographyStyle('pairings', 'row-typography'),
	color: modeTokenVar('pairings', 'primary-text'),
}));

function sideName(row: ScreenOutputRoundMatch, side: ScreenOutputMatchSide | null) {
	if (side)
		return side.name;
	return row.isBye ? 'BYE' : 'TBD';
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="pairings-display broadcast-table-display flex flex-col h-full w-full" :style="displayStyle">
			<div v-if="config.showHeader" class="pairings-header broadcast-table-title" :style="titleDividerStyle">
				<h2 :style="titleStyle">
					{{ headerText }}
				</h2>
			</div>

			<div ref="tableRef" class="pairings-rows broadcast-table-surface" :style="surfaceStyle">
				<div
					v-for="row in pageData"
					:key="row.matchId"
					class="pairing-row broadcast-table-row"
					:class="{ bye: row.isBye }"
					:style="rowStyle"
				>
					<div class="table" :style="secondaryTextStyle">
						{{ row.tableNumber ?? '' }}
					</div>
					<div class="player player-1" :class="{ winner: winner(row) === 1 }" :style="primaryTextStyle">
						{{ sideName(row, row.player1) }}
					</div>
					<div class="versus" :style="secondaryTextStyle">
						vs
					</div>
					<div class="player player-2" :class="{ winner: winner(row) === 2 }" :style="row.isBye ? secondaryTextStyle : primaryTextStyle">
						{{ sideName(row, row.player2) }}
					</div>
					<div class="result" :data-result="resultState(row)" :style="resultStyle(row)">
						{{ formatResult(row) }}
					</div>
				</div>
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.pairings-rows {
	display: flex;
	flex-direction: column;
	padding: 0 1rem;
}
.pairing-row {
	display: grid;
	grid-template-columns: minmax(4rem, auto) minmax(12rem, 1fr) auto minmax(12rem, 1fr) minmax(7rem, auto);
	gap: 1rem;
	align-items: center;
	height: var(--pairings-row-height, auto);
	padding: 0 0.5rem;
	border-bottom-style: solid;
	border-bottom-width: 1px;
	font-size: var(--pairings-row-font-size, 1.5rem);
}
.table,
.versus {
	font-size: var(--pairings-row-secondary-font-size, 1rem);
	font-variant-numeric: tabular-nums;
}
.versus {
	text-transform: uppercase;
}
.player {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.player.winner {
	font-weight: bolder;
}
.player-2 {
	text-align: right;
}
/* Tinted from its own colour, so a Theme's result colour reaches the whole badge. */
.result {
	border: 1px solid currentColor;
	border-radius: 999px;
	background: color-mix(in srgb, currentColor 16%, transparent);
	font-size: var(--pairings-row-secondary-font-size, 1rem);
	font-variant-numeric: tabular-nums;
	justify-self: end;
	min-width: 5.75em;
	padding: 0.42em 0.75em;
	text-align: center;
}
</style>
