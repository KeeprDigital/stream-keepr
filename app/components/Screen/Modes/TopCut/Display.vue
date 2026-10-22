<script setup lang="ts">
import type { BracketPosition } from '~~/shared/modules/top-cut-bracket';
import type { ScreenConfig } from '~~/shared/types/screenConfig';

const { screen } = useScreenContext();
const { config, error, isEmpty, headerText, bracket } = useTopCutModeData();

const screenConfig = computed<Partial<ScreenConfig>>(() => (screen.value?.screenConfig ?? {}) as Partial<ScreenConfig>);

/** Each column's positions in the pairs whose winners meet in the next column. */
const columns = computed(() => bracket.value.columns.map(column => ({
	...column,
	pairs: Array.from({ length: Math.ceil(column.positions.length / 2) }, (_, index) => column.positions.slice(index * 2, index * 2 + 2)),
})));

// The first column seats the most Matches, so it sets the type size that keeps
// every position of a Top 16 on screen. A position's height in ems is its two
// entrant rows and their spacing; an Archetype line under each name (#759)
// adds to it, so the type shrinks to keep a Top 16 whole.
const layoutStyle = computed(() => ({
	'--bracket-rows': String(Math.max(bracket.value.columns[0]?.positions.length ?? 1, 1)),
	'--bracket-position-height': config.value.showArchetypes ? '6.4' : '4.6',
	'--broadcast-table-primary-text': screenConfig.value.primaryTextColor ?? '#ffffff',
	'--broadcast-table-secondary-text': screenConfig.value.secondaryTextColor ?? 'rgba(255, 255, 255, 0.72)',
}));

function entrantLabel(position: BracketPosition, side: 0 | 1): string {
	return position.entrants[side]?.name ?? (position.status === 'bye' ? 'Bye' : 'TBD');
}

function entrantClass(position: BracketPosition, side: 0 | 1) {
	return {
		'is-winner': position.winner === side,
		'is-eliminated': position.winner != null && position.winner !== side,
		'is-unknown': !position.entrants[side],
	};
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="topcut-display broadcast-table-display flex flex-col h-full w-full" :style="layoutStyle">
			<div v-if="config.showHeader" class="broadcast-table-title">
				<h2>{{ headerText }}</h2>
			</div>

			<div class="bracket">
				<div
					v-for="(column, columnIndex) in columns"
					:key="column.roundId ?? `pending-${columnIndex}`"
					class="bracket-column"
				>
					<div class="bracket-column-name broadcast-table-secondary">
						{{ column.name }}
					</div>
					<div class="bracket-pairs">
						<div
							v-for="(pair, pairIndex) in column.pairs"
							:key="pairIndex"
							class="bracket-pair"
							:class="{ 'is-joined': pair.length === 2 }"
						>
							<div
								v-for="(position, positionIndex) in pair"
								:key="position.matchId ?? `position-${pairIndex}-${positionIndex}`"
								class="bracket-position"
								:data-status="position.status"
							>
								<div
									v-for="side in ([0, 1] as const)"
									:key="side"
									class="bracket-entrant"
									:class="entrantClass(position, side)"
								>
									<span v-if="config.showSeeds" class="bracket-entrant-seed broadcast-table-numeric">{{ position.entrants[side]?.seed ?? '' }}</span>
									<div class="bracket-entrant-identity">
										<span class="bracket-entrant-name">{{ entrantLabel(position, side) }}</span>
										<span v-if="config.showArchetypes" class="bracket-entrant-archetype">{{ position.entrants[side]?.deck?.name ?? '' }}</span>
									</div>
									<span v-if="position.gameWins[side] != null" class="bracket-entrant-score broadcast-table-numeric">{{ position.gameWins[side] }}</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div v-if="bracket.champion" class="bracket-champion">
					<div class="bracket-column-name broadcast-table-secondary">
						Champion
					</div>
					<div class="bracket-champion-name">
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
	font-family: var(--font-body);
	font-size: max(0.75rem, 0.6em);
	font-weight: 800;
	letter-spacing: 0.1em;
	padding-bottom: 0.4em;
	text-align: center;
	text-transform: uppercase;
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

/* The bracket line joining a pair's two positions to the position their winners meet in. */
.bracket-pair.is-joined::after {
	border: 2px solid rgba(255, 255, 255, 0.25);
	border-left: none;
	bottom: 25%;
	content: '';
	pointer-events: none;
	position: absolute;
	right: calc(var(--bracket-gap) / -2);
	top: 25%;
	width: calc(var(--bracket-gap) / 2);
}

.bracket-position {
	background: rgba(255, 255, 255, 0.06);
	border: 1px solid rgba(255, 255, 255, 0.14);
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
	line-height: 1.15;
	padding: 0.3em 0.6em;
}

.bracket-entrant + .bracket-entrant {
	border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.bracket-entrant-seed {
	color: var(--broadcast-table-secondary-text, rgba(255, 255, 255, 0.72));
	flex-shrink: 0;
	font-size: 0.8em;
	font-weight: 700;
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
	color: var(--broadcast-table-secondary-text, rgba(255, 255, 255, 0.72));
	font-size: 0.75em;
	font-weight: 600;
	min-height: 1.15em;
}

.bracket-entrant-score {
	flex-shrink: 0;
	font-weight: 700;
}

.bracket-entrant.is-winner {
	background: rgba(255, 255, 255, 0.14);
	font-weight: 800;
}

.bracket-entrant.is-eliminated,
.bracket-entrant.is-unknown {
	color: var(--broadcast-table-secondary-text, rgba(255, 255, 255, 0.72));
}

.bracket-entrant.is-eliminated .bracket-entrant-name {
	opacity: 0.7;
}

.bracket-champion {
	justify-content: center;
}

.bracket-champion-name {
	border: 2px solid rgba(255, 255, 255, 0.4);
	border-radius: 0.3em;
	font-size: 1.25em;
	font-weight: 800;
	padding: 0.5em 0.75em;
	text-align: center;
}
</style>
