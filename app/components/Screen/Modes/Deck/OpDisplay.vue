<script setup lang="ts">
import { useElementSize } from '@vueuse/core';
import { DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { cardBadgeTextSize, DECK_AUTO_BADGE_RATIOS } from '~~/shared/utils/cardBadgeSize';
import { CARD_ASPECT } from '~~/shared/utils/cardGrid';
import { solveDeckGroups } from '~~/shared/utils/deckLayout';
import { ninePointPlacement } from '~~/shared/utils/ninePoints';
import { foundationTokenVar, foundationTypographyStyle, modeTokenVar } from '~/modules/screen-mode';
import { CARD_BADGE_POSITION_CLASSES } from '~/utils/cardBadgePosition';

/**
 * A One Piece Card Game Deck List, from one player side of a Feature Match
 * Slot or from a Player (ADR-0057, ADR-0074): its Leader large, a cost curve
 * under it, and the Mainboard grouped Character, Event, Stage, each by cost.
 * It has no Sideboard, so no Board Selection; its cards are laid out by the
 * Mainboard's layout block (ADR-0054).
 */
const context = useScreenContext();
const {
	config,
	displayedDeckListId,
	playerName,
	leader,
	groups,
	costCurve,
	error,
	ready,
} = useOpDeckModeData(context);

const primaryTextStyle = {
	color: foundationTokenVar('text-primary'),
};
const secondaryTextStyle = {
	color: foundationTokenVar('text-secondary'),
};
const titleStyle = {
	...foundationTypographyStyle('heading'),
	...primaryTextStyle,
};
const displayStyle = {
	...foundationTypographyStyle('body'),
	...primaryTextStyle,
};

const layout = computed(() => resolveDeckBoards(config.value).mainboard);

// ── The Card Layout, from the space the groups really have ──
// The groups sit one under the other and are laid out together (ADR-0054):
// one column count, so their cards line up, and one card size, the largest at
// which every group fits the space beside the Leader.

/** The space between groups, in Event Canvas px: the layout's gap, set from this. */
const GROUP_GAP = 16;

// A group's heading is measured, as its Theme types it, from a hidden copy.
const labelProbe = ref<HTMLElement | null>(null);
const groupLabelHeight = useLayoutHeight(labelProbe);

const groupsElement = ref<HTMLElement | null>(null);
const { width: groupsWidth, height: groupsHeight } = useElementSize(groupsElement);

const solved = computed(() => solveDeckGroups({
	counts: groups.value.map(group => group.cards.length),
	width: groupsWidth.value,
	height: groupsHeight.value,
	columns: layout.value.columns,
	maxCardWidth: layout.value.maxCardSize,
	gap: layout.value.cardGap,
	labelHeight: groupLabelHeight.value,
	groupGap: GROUP_GAP,
}));
const cardWidth = computed(() => `${solved.value.cardWidth}px`);
const cardGap = computed(() => `${solved.value.gap}px`);

function groupRows(index: number): number {
	return solved.value.rows[index] ?? 1;
}

/** Each group takes exactly its solved height: its heading, its rows and the gaps between them. */
function groupStyle(index: number) {
	const rows = groupRows(index);
	const { cardWidth, gap } = solved.value;
	return {
		flex: 'none',
		height: `${groupLabelHeight.value + rows * (cardWidth / CARD_ASPECT) + (rows - 1) * gap}px`,
	};
}

/** The groups sit together, up and down, at the Mainboard's alignment; each grid places its cards across. */
const groupsStyle = computed(() => ({
	gap: `${GROUP_GAP}px`,
	justifyContent: ninePointPlacement(layout.value.alignment).y,
}));

const showPlayerName = computed(() => config.value.showPlayerName !== false && !!playerName.value);
const showLeaderName = computed(() => config.value.showDeckName !== false && !!leader.value);
const showLeaderColors = computed(() => config.value.showDeckColors !== false && !!leader.value?.colors.length);
const showHeader = computed(() => showPlayerName.value || showLeaderName.value || showLeaderColors.value);
const showCostCurve = computed(() => config.value.showCostCurve !== false && costCurve.value.length > 0);

const costCurveMax = computed(() => Math.max(1, ...costCurve.value.map(bucket => bucket.count)));

const quantityPositionClass = computed(() =>
	CARD_BADGE_POSITION_CLASSES[config.value.quantityPosition ?? DEFAULT_QUANTITY_POSITION]);
const quantityBadgeStyle = computed(() => ({
	fontSize: `${cardBadgeTextSize(config.value.quantityBadgeSize, solved.value.cardWidth, DECK_AUTO_BADGE_RATIOS.quantityBadgeSize)}px`,
	width: '1.75em',
	height: '1.75em',
	color: modeTokenVar('deck', 'quantity-badge-text'),
	backgroundColor: modeTokenVar('deck', 'quantity-badge-surface'),
}));
</script>

<template>
	<ScreenModeBase :error="error" :ready="ready">
		<div
			data-testid="op-deck"
			class="w-full h-full"
			:data-deck-state="displayedDeckListId === null ? 'empty' : 'deck'"
			:data-deck-list-id="displayedDeckListId ?? undefined"
			:style="displayStyle"
		>
			<transition mode="out-in" name="deck-swap">
				<div v-if="displayedDeckListId !== null" :key="displayedDeckListId" class="flex flex-col w-full h-full">
					<div v-if="showHeader" class="shrink-0 mb-4 flex flex-wrap items-center justify-center gap-3 text-center">
						<h2
							v-if="showPlayerName"
							data-testid="deck-player-name"
							class="text-xl"
							:style="titleStyle"
						>
							{{ playerName }}
						</h2>
						<p v-if="showLeaderName" data-testid="deck-name" :style="secondaryTextStyle">
							{{ leader!.name }}
						</p>
						<OpColorDisplay v-if="showLeaderColors" :colors="leader!.colors" size="lg" />
					</div>

					<div class="flex flex-1 min-h-0 gap-6">
						<!-- The Leader fits a fixed share of the Screen. -->
						<div class="flex flex-col shrink-0 min-h-0 gap-4 w-[28%]">
							<div v-if="leader" class="op-leader-space flex-1 min-h-0 flex justify-center items-start">
								<div
									data-testid="op-deck-leader"
									:data-number="leader.number"
									class="op-leader mtg-card"
								>
									<img :src="leader.imageUrl" :alt="leader.name" class="w-full h-full object-cover">
								</div>
							</div>

							<div
								v-if="showCostCurve"
								data-testid="op-cost-curve"
								class="shrink-0 flex items-end gap-1 h-28"
								aria-label="Cost curve"
								role="img"
							>
								<div
									v-for="bucket in costCurve"
									:key="bucket.cost"
									data-testid="op-cost-curve-bar"
									:data-cost="bucket.cost"
									:data-count="bucket.count"
									class="flex flex-col items-center justify-end flex-1 h-full min-w-0"
								>
									<span class="text-xs tabular-nums" :style="secondaryTextStyle">{{ bucket.count || '' }}</span>
									<div
										class="w-full rounded-t"
										:style="{
											height: `${(bucket.count / costCurveMax) * 100}%`,
											backgroundColor: modeTokenVar('deck', 'meta-pill-accent'),
										}"
									/>
									<span class="text-xs tabular-nums" :style="secondaryTextStyle">{{ bucket.cost }}</span>
								</div>
							</div>
						</div>

						<!-- A group heading as the Theme types it, measured for the layout. -->
						<div ref="labelProbe" aria-hidden="true" class="invisible absolute pointer-events-none">
							<h3 class="text-lg pb-2" :style="titleStyle">
								Character
							</h3>
						</div>

						<div
							ref="groupsElement"
							data-testid="op-deck-groups"
							class="flex flex-col flex-1 min-w-0 min-h-0"
							:style="groupsStyle"
						>
							<section
								v-for="(group, index) in groups"
								:key="group.key"
								data-testid="op-deck-group"
								:data-group="group.key"
								:data-count="group.count"
								class="flex flex-col min-h-0 min-w-0"
								:style="groupStyle(index)"
							>
								<h3 class="text-lg shrink-0 pb-2" :style="titleStyle">
									{{ group.label }} <span class="tabular-nums" :style="secondaryTextStyle">{{ group.count }}</span>
								</h3>
								<ScreenCardGrid
									:columns="solved.columns"
									:rows="groupRows(index)"
									:card-width="cardWidth"
									:gap="cardGap"
									:alignment="layout.alignment"
								>
									<ScreenModesDeckOpCard
										v-for="card in group.cards"
										:key="card.number"
										:card="card"
										:show-quantity="config.showQuantities !== false"
										:quantity-position-class="quantityPositionClass"
										:quantity-badge-style="quantityBadgeStyle"
									/>
								</ScreenCardGrid>
							</section>
						</div>
					</div>
				</div>
			</transition>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.op-leader-space {
	container-type: size;
}

/* The Leader fits its space both ways. */
.op-leader {
	width: min(100cqw, 100cqh * 61 / 85);
}

.deck-swap-enter-active,
.deck-swap-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.deck-swap-enter-from,
.deck-swap-leave-to {
	opacity: 0;
	transform: scale(0.985);
}
</style>
