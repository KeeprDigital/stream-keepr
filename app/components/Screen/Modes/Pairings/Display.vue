<script setup lang="ts">
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import type { ScreenOutputPairing, ScreenOutputPairingSide } from '~~/shared/types/screenOutputReads';
import { useElementSize } from '@vueuse/core';

const { screen } = useScreenContext();
const { config, error, isEmpty, headerText, pageData, formatResult, winner } = usePairingsModeData();

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
		'--pairings-row-height': `${rowHeight}px`,
		'--pairings-row-font-size': `${primaryFontSize}px`,
		'--pairings-row-secondary-font-size': `${secondaryFontSize}px`,
		'--broadcast-table-primary-text': screenConfig.value.primaryTextColor ?? '#ffffff',
		'--broadcast-table-secondary-text': screenConfig.value.secondaryTextColor ?? 'rgba(255, 255, 255, 0.72)',
	};
});

function sideName(row: ScreenOutputPairing, side: ScreenOutputPairingSide | null) {
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
		<div class="pairings-display broadcast-table-display flex flex-col h-full w-full" :style="rowLayoutStyle">
			<div v-if="config.showHeader" class="pairings-header broadcast-table-title">
				<h2 :style="primaryTextStyle">
					{{ headerText }}
				</h2>
			</div>

			<div ref="tableRef" class="pairings-rows broadcast-table-surface">
				<div
					v-for="row in pageData"
					:key="row.matchId"
					class="pairing-row broadcast-table-row"
					:class="{ bye: row.isBye }"
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
					<div class="result" :class="{ 'result-pending': !row.hasResult && !row.isBye, 'result-bye': row.isBye }">
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
	font-size: var(--pairings-row-font-size, 1.5rem);
}
.table,
.versus {
	font-family: var(--font-mono);
	font-size: var(--pairings-row-secondary-font-size, 1rem);
	font-variant-numeric: tabular-nums;
}
.versus {
	text-transform: uppercase;
}
.player {
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.player.winner {
	font-weight: 900;
}
.player-2 {
	text-align: right;
}
.result {
	border: 1px solid currentColor;
	border-radius: 999px;
	font-family: var(--font-mono);
	font-size: var(--pairings-row-secondary-font-size, 1rem);
	font-variant-numeric: tabular-nums;
	font-weight: 900;
	justify-self: end;
	letter-spacing: 0.06em;
	line-height: 1;
	min-width: 5.75em;
	padding: 0.42em 0.75em;
	text-align: center;
	text-transform: uppercase;
	background: rgba(34, 197, 94, 0.18);
	color: #4ade80;
}
.result-pending {
	background: rgba(255, 255, 255, 0.08);
	color: rgba(255, 255, 255, 0.68);
}
.result-bye {
	background: rgba(250, 204, 21, 0.16);
	color: #facc15;
}
</style>
