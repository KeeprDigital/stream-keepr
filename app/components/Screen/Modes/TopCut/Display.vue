<script setup lang="ts">
import type { BracketPosition } from '~~/shared/modules/top-cut-bracket';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const { config, error, isEmpty, headerText, bracket } = useTopCutModeData();

/** Set on the root, over the shared broadcast table chrome's own colour and face. */
const displayStyle = {
	...modeTypographyStyle('top-cut', 'entrant-typography'),
	color: modeTokenVar('top-cut', 'primary-text'),
};
const titleDividerStyle = {
	borderBottomColor: modeTokenVar('top-cut', 'title-divider'),
};
const titleStyle = {
	...modeTypographyStyle('top-cut', 'title-typography'),
	color: modeTokenVar('top-cut', 'title-text'),
};
const roundNameStyle = {
	...modeTypographyStyle('top-cut', 'round-name-typography'),
	color: modeTokenVar('top-cut', 'round-name-text'),
};
const secondaryTextStyle = {
	color: modeTokenVar('top-cut', 'secondary-text'),
};
const connectorStyle = {
	borderColor: modeTokenVar('top-cut', 'connector'),
};
const championStyle = {
	...modeTypographyStyle('top-cut', 'champion-typography'),
	borderColor: modeTokenVar('top-cut', 'champion-border'),
};

/** Each column's positions in the pairs whose winners meet in the next column. */
const columns = computed(() => bracket.value.columns.map(column => ({
	...column,
	pairs: Array.from({
		length: Math.ceil(column.positions.length / 2),
	}, (_, index) => column.positions.slice(index * 2, index * 2 + 2)),
})));

// The first column seats the most Matches, so it sets the type size that keeps
// every position of a Top 16 on screen. A position's height in ems is its two
// entrant rows and their spacing; an Archetype line under each name (#759)
// adds to it, so the type shrinks to keep a Top 16 whole.
const layoutStyle = computed(() => ({
	'--bracket-rows': String(Math.max(bracket.value.columns[0]?.positions.length ?? 1, 1)),
	'--bracket-position-height': config.value.showArchetypes ? '6.4' : '4.6',
}));

function entrantLabel(position: BracketPosition, side: 0 | 1): string {
	return position.entrants[side]?.name ?? (position.status === 'bye'
		? 'Bye'
		: 'TBD');
}

function entrantClass(position: BracketPosition, side: 0 | 1) {
	return {
		'is-winner': position.winner === side,
		'is-eliminated': position.winner != null && position.winner !== side,
		'is-unknown': !position.entrants[side],
	};
}

/** A pending Bracket Position, which no Match fills yet, has its own border. */
function positionStyle(position: BracketPosition) {
	return {
		backgroundColor: modeTokenVar('top-cut', 'position-surface'),
		borderColor: position.status === 'awaiting'
			? modeTokenVar('top-cut', 'pending-position-border')
			: modeTokenVar('top-cut', 'position-border'),
	};
}

/** A winner sits on its own surface; an eliminated or unknown entrant reads as secondary text. */
function entrantStyle(position: BracketPosition, side: 0 | 1) {
	const { 'is-winner': isWinner, 'is-eliminated': isEliminated, 'is-unknown': isUnknown } = entrantClass(position, side);
	return {
		borderTopColor: side === 1
			? modeTokenVar('top-cut', 'entrant-divider')
			: undefined,
		backgroundColor: isWinner
			? modeTokenVar('top-cut', 'winner-surface')
			: undefined,
		color: isEliminated || isUnknown
			? secondaryTextStyle.color
			: undefined,
	};
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="topcut-display broadcast-table-display flex flex-col h-full w-full" :style="[layoutStyle, displayStyle]">
			<div v-if="config.showHeader" class="broadcast-table-title" :style="titleDividerStyle">
				<h2 :style="titleStyle">
					{{ headerText }}
				</h2>
			</div>

			<div class="bracket">
				<div
					v-for="(column, columnIndex) in columns"
					:key="column.roundId ?? `pending-${columnIndex}`"
					class="bracket-column"
				>
					<div class="bracket-column-name" :style="roundNameStyle">
						{{ column.name }}
					</div>
					<div class="bracket-pairs">
						<div
							v-for="(pair, pairIndex) in column.pairs"
							:key="pairIndex"
							class="bracket-pair"
						>
							<!-- The bracket line joining a pair's two positions to the position their winners meet in. -->
							<div
								v-if="pair.length === 2"
								class="bracket-connector"
								aria-hidden="true"
								:style="connectorStyle"
							/>
							<div
								v-for="(position, positionIndex) in pair"
								:key="position.matchId ?? `position-${pairIndex}-${positionIndex}`"
								class="bracket-position"
								:data-status="position.status"
								:style="positionStyle(position)"
							>
								<div
									v-for="side in ([0, 1] as const)"
									:key="side"
									class="bracket-entrant"
									:class="entrantClass(position, side)"
									:style="entrantStyle(position, side)"
								>
									<span v-if="config.showSeeds" class="bracket-entrant-seed" :style="secondaryTextStyle">{{ position.entrants[side]?.seed ?? '' }}</span>
									<div class="bracket-entrant-identity">
										<span class="bracket-entrant-name">{{ entrantLabel(position, side) }}</span>
										<span v-if="config.showArchetypes" class="bracket-entrant-archetype" :style="secondaryTextStyle">{{ position.entrants[side]?.deck?.name ?? '' }}</span>
									</div>
									<span v-if="position.gameWins[side] != null" class="bracket-entrant-score">{{ position.gameWins[side] }}</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div v-if="bracket.champion" class="bracket-champion">
					<div class="bracket-column-name" :style="roundNameStyle">
						Champion
					</div>
					<div class="bracket-champion-name" :style="championStyle">
						{{ bracket.champion.name }}
					</div>
				</div>
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.bracket {
	--bracket-gap: clamp(1rem, 2.5cqw, 2.5rem);
	container-type: size;
	display: flex;
	flex: 1;
	gap: var(--bracket-gap);
	min-height: 0;
	padding: 0.75rem 1rem;
	/* Each position's height in ems, so a Top 16's eight first-column positions fit. */
	font-size: clamp(0.7rem, calc(100cqh / var(--bracket-rows) / var(--bracket-position-height, 4.6)), 2rem);
}

.bracket-column,
.bracket-champion {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-width: 0;
}

.bracket-column-name {
	flex-shrink: 0;
	font-size: max(0.75rem, 0.6em);
	padding-bottom: 0.4em;
	text-align: center;
}

.bracket-pairs {
	display: flex;
	flex: 1;
	flex-direction: column;
	justify-content: space-around;
	min-height: 0;
}

.bracket-pair {
	display: flex;
	flex: 1;
	flex-direction: column;
	justify-content: space-around;
	position: relative;
}

.bracket-connector {
	border-style: solid solid solid none;
	border-width: 2px;
	bottom: 25%;
	pointer-events: none;
	position: absolute;
	right: calc(var(--bracket-gap) / -2);
	top: 25%;
	width: calc(var(--bracket-gap) / 2);
}

.bracket-position {
	border-style: solid;
	border-width: 1px;
	border-radius: 0.3em;
	overflow: hidden;
}

.bracket-position[data-status='awaiting'] {
	border-style: dashed;
}

.bracket-entrant {
	align-items: center;
	display: flex;
	gap: 0.5em;
	justify-content: space-between;
	padding: 0.3em 0.6em;
}

.bracket-entrant + .bracket-entrant {
	border-top-style: solid;
	border-top-width: 1px;
}

.bracket-entrant-seed {
	flex-shrink: 0;
	font-size: 0.8em;
	font-variant-numeric: tabular-nums;
	min-width: 1.6em;
	text-align: right;
}

.bracket-entrant-identity {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-width: 0;
}

.bracket-entrant-name,
.bracket-entrant-archetype {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* Blank for a Player with no Archetype, holding its line so every entrant stays one height. */
.bracket-entrant-archetype {
	font-size: 0.75em;
	min-height: 1.15em;
}

.bracket-entrant-score {
	flex-shrink: 0;
	font-variant-numeric: tabular-nums;
}

.bracket-entrant.is-eliminated .bracket-entrant-name {
	opacity: 0.7;
}

.bracket-champion {
	justify-content: center;
}

.bracket-champion-name {
	border-style: solid;
	border-width: 2px;
	border-radius: 0.3em;
	font-size: 1.25em;
	padding: 0.5em 0.75em;
	text-align: center;
}
</style>
