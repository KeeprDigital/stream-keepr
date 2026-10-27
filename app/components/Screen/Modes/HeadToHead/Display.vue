<script setup lang="ts">
import type { ScreenOutputHeadToHeadEarlierMatch } from '~~/shared/types/screenOutputReads';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const { config, error, isEmpty, firstMeeting, headerText, player1, player2, earlierMatches, formatRecord } = useHeadToHeadModeData();

const primaryTextStyle = {
	color: modeTokenVar('head-to-head', 'primary-text'),
};
const secondaryTextStyle = {
	color: modeTokenVar('head-to-head', 'secondary-text'),
};
const titleStyle = {
	...modeTypographyStyle('head-to-head', 'title-typography'),
	color: modeTokenVar('head-to-head', 'title-text'),
};
const titleDividerStyle = {
	borderBottomColor: modeTokenVar('head-to-head', 'title-divider'),
};
const nameStyle = {
	...modeTypographyStyle('head-to-head', 'name-typography'),
	...primaryTextStyle,
};
const labelStyle = {
	...modeTypographyStyle('head-to-head', 'label-typography'),
	...secondaryTextStyle,
};
/** Over the shared header row's own face, colour and rule. */
const listTitleStyle = {
	...labelStyle,
	borderBottomColor: modeTokenVar('head-to-head', 'row-divider'),
};
/** On each row too, over the shared row chrome's own line height. */
const rowStyle = {
	...modeTypographyStyle('head-to-head', 'row-typography'),
	borderBottomColor: modeTokenVar('head-to-head', 'row-divider'),
};
const surfaceStyle = {
	backgroundColor: modeTokenVar('head-to-head', 'surface'),
};

/** Set on the root, over the shared broadcast table chrome's own colour and face. */
const displayStyle = {
	...modeTypographyStyle('head-to-head', 'row-typography'),
	color: modeTokenVar('head-to-head', 'primary-text'),
};

const players = computed(() => [player1.value, player2.value]);

/** How an earlier Match ended: its winner by name, or a draw. */
function outcomeLabel({ outcome }: ScreenOutputHeadToHeadEarlierMatch): string {
	switch (outcome) {
		case 'player1':
			return player1.value?.name ?? '';
		case 'player2':
			return player2.value?.name ?? '';
		case 'draw':
			return 'Draw';
	}
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="head-to-head-display broadcast-table-display flex flex-col h-full w-full" :style="displayStyle">
			<div v-if="config.showHeader" class="head-to-head-header broadcast-table-title" :style="titleDividerStyle">
				<h2 :style="titleStyle">
					{{ headerText }}
				</h2>
			</div>

			<div class="head-to-head-players">
				<template v-for="(side, index) in players" :key="index">
					<div v-if="index === 1" class="versus" :style="labelStyle">
						vs
					</div>
					<div class="head-to-head-player" :class="`player-${index + 1}`">
						<div class="name" :style="nameStyle">
							{{ side?.name ?? 'TBD' }}
						</div>
						<div v-if="side?.pronouns" class="pronouns" :style="secondaryTextStyle">
							{{ side.pronouns }}
						</div>
						<div v-if="side" class="stats" :style="secondaryTextStyle">
							<span v-if="formatRecord(side)" class="record">{{ formatRecord(side) }}</span>
							<span v-if="side.points != null" class="points">{{ side.points }} pts</span>
						</div>
						<div v-if="side?.deckName" class="deck" :style="primaryTextStyle">
							{{ side.deckName }}
							<MtgManaColorDisplay
								v-if="side.deckColors"
								:colors="side.deckColors"
								size="sm"
								class="inline-flex ml-2 align-middle"
							/>
						</div>
					</div>
				</template>
			</div>

			<div class="head-to-head-earlier-matches broadcast-table-surface" :style="surfaceStyle">
				<p v-if="firstMeeting" class="first-meeting" :style="labelStyle">
					First meeting
				</p>
				<template v-else-if="earlierMatches.length > 0">
					<p class="earlier-matches-title broadcast-table-header-row" :style="listTitleStyle">
						Earlier Matches
					</p>
					<div
						v-for="earlierMatch in earlierMatches"
						:key="earlierMatch.matchId"
						class="earlier-match broadcast-table-row"
						:style="rowStyle"
					>
						<span class="round" :style="secondaryTextStyle">{{ earlierMatch.roundName }}</span>
						<span class="winner" :style="primaryTextStyle">{{ outcomeLabel(earlierMatch) }}</span>
						<span class="score">{{ earlierMatch.gameScore }}</span>
					</div>
				</template>
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.head-to-head-players {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: 2rem;
	padding: 2rem 1.5rem;
}
.head-to-head-player {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	min-width: 0;
}
.player-2 {
	align-items: flex-end;
	text-align: right;
}
.name {
	font-size: clamp(1.75rem, 3.5vw, 3rem);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 100%;
}
.pronouns {
	font-size: clamp(0.875rem, 1.3vw, 1.25rem);
}
.stats {
	display: flex;
	gap: 1.25rem;
	font-size: clamp(1.125rem, 2vw, 1.75rem);
	font-variant-numeric: tabular-nums;
}
.deck {
	font-size: clamp(1rem, 1.8vw, 1.5rem);
}
.versus {
	font-size: clamp(1.25rem, 2.5vw, 2rem);
}
.head-to-head-earlier-matches {
	padding: 0 1.5rem 1rem;
}
.earlier-matches-title {
	padding: 0.5rem 0;
}
.earlier-match {
	display: grid;
	grid-template-columns: minmax(8rem, 1fr) minmax(0, 2fr) auto;
	gap: 1rem;
	align-items: center;
	padding: 0.75rem 0;
	border-bottom-style: solid;
	border-bottom-width: 1px;
	font-size: clamp(1rem, 1.8vw, 1.5rem);
}
.winner {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.score {
	font-variant-numeric: tabular-nums;
	justify-self: end;
}
.first-meeting {
	padding: 1rem 0;
	text-align: center;
	font-size: clamp(1.25rem, 2.5vw, 2rem);
}
</style>
