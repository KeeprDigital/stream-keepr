<script setup lang="ts">
import type { StandingsColumnKey } from '~~/shared/types/enums';
import type { Player } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { modeMotionVars, modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const {
	config,
	error,
	ready,
	isEmpty,
	headerText,
	visibleColumns,
	pageData,
	formatCell,
	positionChangeOf,
} = useStandingsModeData();

const inset = useScreenInset();

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
/** On each row too, over the shared row chrome's own line height. */
const rowStyle = {
	...modeTypographyStyle('standings', 'row-typography'),
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
	insetY: inset,
});

const contentStyle = {
	width: '100%',
	maxWidth: modeTokenVar('standings', 'max-width'),
	marginInline: 'auto',
};

/**
 * Rows enter from their motion Mode Token's excursion, leave back to it and
 * move on its timing; the `reveal` view mode's rows take `reveal-motion`. An
 * entering row starts an eighth of the duration after the one above it. The
 * row's class reads these, since a move clears an inline transition.
 */
const rowMotionStyle = computed(() => {
	const motion = modeMotionVars('standings', isRevealMode.value ? 'reveal-motion' : 'row-motion');
	return {
		'--standings-row-duration': motion.duration,
		'--standings-row-easing': motion.easing,
		'--standings-row-delay': motion.delay,
		'--standings-row-stagger': `calc(${motion.delay} + var(--row-index) * ${motion.duration} / 8)`,
		'--standings-row-origin': motion.transformOrigin,
		'--standings-row-opacity': motion.opacity,
		'--standings-row-transform': motion.transform,
		'--standings-row-clip': motion.clipPath,
	};
});

/** Set on the root, over the shared broadcast table chrome's own colour and face. */
const displayStyle = {
	...modeTypographyStyle('standings', 'row-typography'),
	color: modeTokenVar('standings', 'primary-text'),
};
</script>

<template>
	<ScreenModeBase
		:error="error"
		:ready="ready"
		:empty="isEmpty"
	>
		<div class="standings-display broadcast-table-display flex flex-col h-full w-full" :style="displayStyle">
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
						name="standings-row"
						tag="div"
						class="standings-rows"
						:style="rowLayoutStyle"
					>
						<div
							v-for="(player, index) in pageData"
							:key="player.id"
							class="standings-row broadcast-table-row"
							:style="[rowStyle, rowMotionStyle, { '--row-index': index }]"
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
	font-variant-numeric: tabular-nums;
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
	font-variant-numeric: tabular-nums;
	font-size: var(--standings-row-secondary-font-size, 0.875rem);
	white-space: nowrap;
}

.cell-points {
	width: 3.25em;
	text-align: center;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

.cell-positionChange {
	width: 3.25em;
	text-align: center;
	font-variant-numeric: tabular-nums;
	font-size: var(--standings-row-secondary-font-size, 0.875rem);
	white-space: nowrap;
}

.cell-positionChange[data-position-change='new'] {
	font-size: calc(var(--standings-row-secondary-font-size, 0.875rem) * 0.8);
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

/* ── Row motion: its timing, and the excursion a row enters from and leaves to ── */
.standings-row {
	transition-property: opacity, transform, clip-path;
	transition-duration: var(--standings-row-duration);
	transition-timing-function: var(--standings-row-easing);
	transition-delay: var(--standings-row-enter-delay, var(--standings-row-delay));
	transform-origin: var(--standings-row-origin);
}

.standings-row-enter-active {
	--standings-row-enter-delay: var(--standings-row-stagger);
}

.standings-row-enter-from,
.standings-row-leave-to {
	opacity: var(--standings-row-opacity);
	transform: var(--standings-row-transform);
	clip-path: var(--standings-row-clip);
}

.standings-row-leave-active {
	position: absolute;
	left: 0;
	right: 0;
}
</style>
