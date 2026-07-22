<script setup lang="ts">
import type { StandingsColumnKey } from '~~/shared/types/enums';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import type { Player } from '~/types';
import { useElementSize } from '@vueuse/core';
import { getMtgGameData } from '~~/shared/utils/gameData';

const { screen } = useScreenContext();

const {
	config,
	error,
	isEmpty,
	headerText,
	visibleColumns,
	pageData,
	formatCell,
} = useStandingsModeData();

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

const isRevealMode = computed(() => config.value.viewMode === 'reveal');

function getCellStyle(key: StandingsColumnKey) {
	switch (key) {
		case 'name':
		case 'points':
			return primaryTextStyle.value;
		case 'position':
		case 'record':
		case 'deck':
			return secondaryTextStyle.value;
	}
}

function getDeckColors(player: Player) {
	return getMtgGameData(player.gameData).deckColors;
}

const tableRef = useTemplateRef<HTMLElement>('tableRef');
const { height: tableHeight } = useElementSize(tableRef);

const layoutRowCount = computed(() => {
	const rowsPerPage = Math.max(config.value.rowsPerPage ?? pageData.value.length ?? 1, 1);

	if (config.value.viewMode === 'reveal') {
		return Math.max(1, Math.min(config.value.revealCount ?? rowsPerPage, rowsPerPage));
	}

	return rowsPerPage;
});
const pageInsetY = computed(() => screenConfig.value.paddingY ?? 0);

const rowLayoutStyle = computed(() => {
	const baseRowHeight = 44;
	const availableHeight = tableHeight.value > 0
		? tableHeight.value
		: layoutRowCount.value * baseRowHeight;
	const usableHeight = Math.max(availableHeight - pageInsetY.value, layoutRowCount.value * 24);
	const rowHeight = usableHeight / layoutRowCount.value;
	const primaryFontSize = Math.max(14, 14 + ((rowHeight - 36) * 0.16));
	const secondaryFontSize = Math.max(12, primaryFontSize * 0.84);
	const paddingY = Math.max(4, rowHeight * 0.12);
	const paddingX = Math.max(10, primaryFontSize * 0.75);

	return {
		'--standings-row-height': `${rowHeight}px`,
		'--standings-row-font-size': `${primaryFontSize}px`,
		'--standings-row-secondary-font-size': `${secondaryFontSize}px`,
		'--standings-row-padding-y': `${paddingY}px`,
		'--standings-row-padding-x': `${paddingX}px`,
	};
});

const contentStyle = computed(() => ({
	'width': '100%',
	'maxWidth': config.value.maxTableWidth ? `${config.value.maxTableWidth}px` : undefined,
	'marginInline': config.value.maxTableWidth ? 'auto' : undefined,
	'--broadcast-table-primary-text': screenConfig.value.primaryTextColor ?? '#ffffff',
	'--broadcast-table-secondary-text': screenConfig.value.secondaryTextColor ?? 'rgba(255, 255, 255, 0.72)',
}));
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="standings-display broadcast-table-display flex flex-col h-full w-full" :class="{ 'reveal-mode': isRevealMode }">
			<div data-testid="standings-content" class="standings-content broadcast-table-content flex flex-col h-full w-full" :style="contentStyle">
				<!-- Header -->
				<div v-if="config.showHeader" class="standings-header broadcast-table-title">
					<h2 :style="primaryTextStyle">
						{{ headerText }}
					</h2>
				</div>

				<!-- Table -->
				<div ref="tableRef" class="standings-table broadcast-table-surface">
					<TransitionGroup
						v-if="config.animateEntries"
						name="standings-row"
						tag="div"
						class="standings-rows"
						:style="rowLayoutStyle"
					>
						<div
							v-for="(player, index) in pageData"
							:key="player.id"
							class="standings-row broadcast-table-row"
							:style="{ '--row-index': index }"
						>
							<template v-for="col in visibleColumns" :key="col.key">
								<div class="standings-cell" :class="`cell-${col.key}`" :style="getCellStyle(col.key)">
									<template v-if="col.key === 'deck'">
										<span class="deck-cell-content">
											<span class="deck-cell-text">{{ formatCell(player, col.key) }}</span>
											<span
												v-if="config.showArchetypeColors && getDeckColors(player)"
												data-testid="standings-deck-colors"
												class="deck-cell-colors"
											>
												<MtgManaColorDisplay :colors="getDeckColors(player)" size="xs" />
											</span>
										</span>
									</template>
									<template v-else>
										{{ formatCell(player, col.key) }}
									</template>
								</div>
							</template>
						</div>
					</TransitionGroup>

					<!-- Non-animated fallback -->
					<div v-else class="standings-rows" :style="rowLayoutStyle">
						<div
							v-for="player in pageData"
							:key="player.id"
							class="standings-row broadcast-table-row"
						>
							<template v-for="col in visibleColumns" :key="col.key">
								<div class="standings-cell" :class="`cell-${col.key}`" :style="getCellStyle(col.key)">
									<template v-if="col.key === 'deck'">
										<span class="deck-cell-content">
											<span class="deck-cell-text">{{ formatCell(player, col.key) }}</span>
											<span
												v-if="config.showArchetypeColors && getDeckColors(player)"
												data-testid="standings-deck-colors"
												class="deck-cell-colors"
											>
												<MtgManaColorDisplay :colors="getDeckColors(player)" size="xs" />
											</span>
										</span>
									</template>
									<template v-else>
										{{ formatCell(player, col.key) }}
									</template>
								</div>
							</template>
						</div>
					</div>
				</div>
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.standings-row {
	display: flex;
	align-items: center;
	height: var(--standings-row-height, auto);
	padding: var(--standings-row-padding-y, 0.625rem) var(--standings-row-padding-x, 1rem);
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	width: 100%;
	box-sizing: border-box;
	font-size: var(--standings-row-font-size, 1rem);
	line-height: 1.1;
}

.standings-row:last-child {
	border-bottom: none;
}

.standings-cell {
	padding: 0 0.375rem;
}

.standings-rows {
	position: relative;
	height: 100%;
	display: flex;
	flex-direction: column;
}

.cell-position {
	width: 2.5em;
	text-align: center;
	font-family: var(--font-mono);
	font-weight: 700;
	font-size: var(--standings-row-secondary-font-size, 0.875rem);
}

.cell-name {
	flex: 1 1 0;
	min-width: 0;
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.cell-record {
	width: 4.25em;
	text-align: center;
	font-family: var(--font-mono);
	font-size: var(--standings-row-secondary-font-size, 0.875rem);
	white-space: nowrap;
}

.cell-points {
	width: 3.25em;
	text-align: center;
	font-family: var(--font-mono);
	white-space: nowrap;
}

.cell-deck {
	flex: 1.15 1.15 0;
	min-width: 0;
	font-size: var(--standings-row-secondary-font-size, 0.875rem);
}

.deck-cell-content {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	min-width: 0;
}

.deck-cell-text {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.deck-cell-colors {
	flex-shrink: 0;
}

/* ── Entry Animation (staggered) ── */
.standings-row-enter-active {
	transition: all 0.4s ease;
	transition-delay: calc(var(--row-index) * 0.05s);
}

.standings-row-enter-from {
	opacity: 0;
	transform: translateX(-20px);
}

.standings-row-leave-active {
	transition: all 0.3s ease;
	position: absolute;
	left: 0;
	right: 0;
}

.standings-row-leave-to {
	opacity: 0;
	transform: translateX(20px);
}

.standings-row-move {
	transition: transform 0.4s ease;
}

/* ── Reveal Mode: More Dramatic Animation ── */
.reveal-mode .standings-row-enter-active {
	transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	transition-delay: calc(var(--row-index) * 0.05s);
}

.reveal-mode .standings-row-enter-from {
	opacity: 0;
	transform: translateY(20px) scale(0.95);
}
</style>
