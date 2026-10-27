<script setup lang="ts">
import type { StandingsColumnKey } from '~~/shared/types/enums';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import type { Player } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const { screen } = useScreenContext();

const {
	config,
	error,
	isEmpty,
	headerText,
	visibleColumns,
	pageData,
	formatCell,
	positionChangeOf,
} = useStandingsModeData();

const screenConfig = computed<Partial<ScreenConfig>>(() => (screen.value?.screenConfig ?? {}) as Partial<ScreenConfig>);

const primaryTextStyle = {
	color: modeTokenVar('standings', 'primary-text'),
};
const secondaryTextStyle = {
	color: modeTokenVar('standings', 'secondary-text'),
};
const titleStyle = {
	...modeTypographyStyle('standings', 'title-typography'),
	color: modeTokenVar('standings', 'title-text'),
};
const titleDividerStyle = {
	borderBottomColor: modeTokenVar('standings', 'title-divider'),
};
const rowStyle = {
	borderBottomColor: modeTokenVar('standings', 'row-divider'),
};
const surfaceStyle = {
	backgroundColor: modeTokenVar('standings', 'surface'),
};

const isRevealMode = computed(() => config.value.viewMode === 'reveal');

function getCellStyle(key: StandingsColumnKey, player: Player) {
	switch (key) {
		case 'name':
		case 'points':
			return primaryTextStyle;
		case 'position':
		case 'record':
		case 'deck':
			return secondaryTextStyle;
		case 'positionChange': {
			// A climb or a drop shows in its own colour; everything else reads
			// as secondary text. The arrow carries the direction; the colour
			// only reinforces it.
			const { kind } = positionChangeOf(player);
			if (kind === 'up') {
				return {
					color: modeTokenVar('standings', 'rise'),
				};
			}
			if (kind === 'down') {
				return {
					color: modeTokenVar('standings', 'fall'),
				};
			}
			return secondaryTextStyle;
		}
	}
}

/** A Position Change cell's direction, which its colour reads from. */
function positionChangeKind(key: StandingsColumnKey, player: Player) {
	return key === 'positionChange'
		? positionChangeOf(player).kind
		: undefined;
}

function getDeckColors(player: Player) {
	return getMtgGameData(player.gameData).deckColors;
}

const layoutRowCount = computed(() => {
	const rowsPerPage = Math.max(config.value.rowsPerPage ?? pageData.value.length ?? 1, 1);

	if (config.value.viewMode === 'reveal') {
		return Math.max(1, Math.min(config.value.revealCount ?? rowsPerPage, rowsPerPage));
	}

	return rowsPerPage;
});

const rowLayoutStyle = useTableRowLayout(useTemplateRef<HTMLElement>('tableRef'), {
	density: 'compact',
	prefix: 'standings',
	rowCount: layoutRowCount,
	insetY: () => screenConfig.value.paddingY ?? 0,
});

const contentStyle = computed(() => ({
	width: '100%',
	maxWidth: config.value.maxTableWidth
		? `${config.value.maxTableWidth}px`
		: undefined,
	marginInline: config.value.maxTableWidth ? 'auto' : undefined,
	...modeTypographyStyle('standings', 'row-typography'),
	color: modeTokenVar('standings', 'primary-text'),
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
				<div v-if="config.showHeader" class="standings-header broadcast-table-title" :style="titleDividerStyle">
					<h2 :style="titleStyle">
						{{ headerText }}
					</h2>
				</div>

				<!-- Table -->
				<div ref="tableRef" class="standings-table broadcast-table-surface" :style="surfaceStyle">
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
							:style="[rowStyle, { '--row-index': index }]"
						>
							<template v-for="col in visibleColumns" :key="col.key">
								<div
									class="standings-cell"
									:class="`cell-${col.key}`"
									:style="getCellStyle(col.key, player)"
									:data-position-change="positionChangeKind(col.key, player)"
								>
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
							:style="rowStyle"
						>
							<template v-for="col in visibleColumns" :key="col.key">
								<div
									class="standings-cell"
									:class="`cell-${col.key}`"
									:style="getCellStyle(col.key, player)"
									:data-position-change="positionChangeKind(col.key, player)"
								>
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
	border-bottom-style: solid;
	border-bottom-width: 1px;
	width: 100%;
	box-sizing: border-box;
	font-size: var(--standings-row-font-size, 1rem);
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

.cell-positionChange {
	width: 3.25em;
	text-align: center;
	font-family: var(--font-mono);
	font-size: var(--standings-row-secondary-font-size, 0.875rem);
	white-space: nowrap;
}

.cell-positionChange[data-position-change='new'] {
	font-size: calc(var(--standings-row-secondary-font-size, 0.875rem) * 0.8);
	text-transform: uppercase;
	letter-spacing: 0.05em;
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
