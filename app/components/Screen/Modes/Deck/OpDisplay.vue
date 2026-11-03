<script setup lang="ts">
import type { OpDeckGroup } from '~~/shared/utils/opDeckLayout';
import { DEFAULT_DECK_TEXT_SIZES, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';
import { CARD_BADGE_POSITION_CLASSES } from '~/utils/cardBadgePosition';

/**
 * A One Piece Card Game Deck List, from one player side of a Feature Match
 * Slot (ADR-0057): the side's Leader large, a cost curve under it, and the
 * Mainboard grouped Character, Event, Stage, each by cost. It has no
 * Sideboard, so no Board Selection; its cards are laid out by the Mainboard's
 * layout block (ADR-0054).
 */
const {
	config,
	displayedDeckListId,
	playerName,
	leader,
	groups,
	costCurve,
	error,
	ready,
} = useFeatureMatchDeckModeData();

const primaryTextStyle = {
	color: modeTokenVar('deck', 'primary-text'),
};
const secondaryTextStyle = {
	color: modeTokenVar('deck', 'secondary-text'),
};
const titleStyle = {
	...modeTypographyStyle('deck', 'title-typography'),
	...primaryTextStyle,
};
const displayStyle = {
	...modeTypographyStyle('deck', 'body-typography'),
	...primaryTextStyle,
};

const layout = computed(() => resolveDeckBoards(config.value).mainboard);
const isFit = computed(() => layout.value.cardSizing === 'fit');

/** Every group shares one column count, so their cards line up. */
const columns = useCardGridColumns({
	sizing: () => layout.value.cardSizing,
	autoColumns: () => layout.value.autoColumns,
	columns: () => layout.value.columns,
	count: () => Math.max(1, ...groups.value.map(group => group.cards.length)),
	cardWidth: () => layout.value.cardWidth,
	gap: () => layout.value.cardGap,
});

function gridColumns(): number | 'auto-fill' {
	return !isFit.value && layout.value.autoColumns
		? 'auto-fill'
		: columns.value;
}

function groupRows(group: OpDeckGroup): number {
	return Math.max(1, Math.ceil(group.cards.length / columns.value));
}

/** Fit groups share the height by their rows; Fixed ones take their own. */
function groupStyle(group: OpDeckGroup) {
	return isFit.value
		? { flex: `${groupRows(group)} 1 0%` }
		: { flex: 'none' };
}

/** The Leader is shown at twice a Fixed card's width, or fits a fixed share of the Screen. */
const leaderColumnStyle = computed(() => isFit.value
	? { width: '28%' }
	: { width: `${layout.value.cardWidth * 2}px` });

const showPlayerName = computed(() => config.value.showPlayerName !== false && !!playerName.value);
const showLeaderName = computed(() => config.value.showDeckName !== false && !!leader.value);
const showLeaderColors = computed(() => config.value.showDeckColors !== false && !!leader.value?.colors.length);
const showHeader = computed(() => showPlayerName.value || showLeaderName.value || showLeaderColors.value);
const showCostCurve = computed(() => config.value.showCostCurve !== false && costCurve.value.length > 0);

const costCurveMax = computed(() => Math.max(1, ...costCurve.value.map(bucket => bucket.count)));

const quantityPositionClass = computed(() =>
	CARD_BADGE_POSITION_CLASSES[config.value.quantityPosition ?? DEFAULT_QUANTITY_POSITION]);
const quantityBadgeStyle = computed(() => ({
	fontSize: `${config.value.quantityBadgeSize ?? DEFAULT_DECK_TEXT_SIZES.quantityBadgeSize}px`,
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
						<div class="flex flex-col shrink-0 min-h-0 gap-4" :style="leaderColumnStyle">
							<div v-if="leader" class="op-leader-space flex-1 min-h-0 flex justify-center items-start">
								<div
									data-testid="op-deck-leader"
									:data-number="leader.number"
									class="op-leader mtg-card"
									:class="{ 'op-leader--fit': isFit }"
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

						<div class="flex flex-col flex-1 min-w-0 min-h-0 gap-4">
							<section
								v-for="group in groups"
								:key="group.key"
								data-testid="op-deck-group"
								:data-group="group.key"
								:data-count="group.count"
								class="flex flex-col min-h-0 min-w-0"
								:style="groupStyle(group)"
							>
								<h3 class="text-lg shrink-0 pb-2" :style="titleStyle">
									{{ group.label }} <span class="tabular-nums" :style="secondaryTextStyle">{{ group.count }}</span>
								</h3>
								<ScreenCardGrid
									:sizing="layout.cardSizing"
									:columns="gridColumns()"
									:rows="groupRows(group)"
									:card-width="`${layout.cardWidth}px`"
									:gap="`${layout.cardGap}px`"
									:alignment="layout.alignment"
								>
									<ScreenModesDeckOpCard
										v-for="card in group.cards"
										:key="card.number"
										:card="card"
										:width="`${layout.cardWidth}px`"
										:sizing="layout.cardSizing"
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

.op-leader {
	width: 100%;
}

/* A Fit Leader fits its space both ways. */
.op-leader--fit {
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
