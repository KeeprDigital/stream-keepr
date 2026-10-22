<script setup lang="ts">
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import type { ScreenOutputHeadToHeadMeeting } from '~~/shared/types/screenOutputReads';

const { screen } = useScreenContext();
const { config, error, isEmpty, firstMeeting, headerText, player1, player2, meetings, formatRecord } = useHeadToHeadModeData();

const screenConfig = computed<Partial<ScreenConfig>>(() => (screen.value?.screenConfig ?? {}) as Partial<ScreenConfig>);
const primaryTextStyle = computed(() => screenConfig.value.primaryTextColor ? { color: screenConfig.value.primaryTextColor } : {});
const secondaryTextStyle = computed(() => screenConfig.value.secondaryTextColor ? { color: screenConfig.value.secondaryTextColor } : { opacity: '0.75' });
const displayStyle = computed(() => ({
	'--broadcast-table-primary-text': screenConfig.value.primaryTextColor ?? '#ffffff',
	'--broadcast-table-secondary-text': screenConfig.value.secondaryTextColor ?? 'rgba(255, 255, 255, 0.72)',
}));

const sides = computed(() => [player1.value, player2.value]);

/** Who won an earlier meeting, by name; a draw names no one. */
function winnerName(meeting: ScreenOutputHeadToHeadMeeting): string {
	return sides.value.find(side => side && side.id === meeting.winnerId)?.name ?? 'Draw';
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="head-to-head-display broadcast-table-display flex flex-col h-full w-full" :style="displayStyle">
			<div v-if="config.showHeader" class="head-to-head-header broadcast-table-title">
				<h2 :style="primaryTextStyle">
					{{ headerText }}
				</h2>
			</div>

			<div class="head-to-head-players">
				<template v-for="(side, index) in sides" :key="index">
					<div v-if="index === 1" class="versus" :style="secondaryTextStyle">
						vs
					</div>
					<div class="head-to-head-player" :class="`player-${index + 1}`">
						<div class="name" :style="primaryTextStyle">
							{{ side?.name ?? 'TBD' }}
						</div>
						<div v-if="side?.pronouns" class="pronouns" :style="secondaryTextStyle">
							{{ side.pronouns }}
						</div>
						<div v-if="side" class="stats broadcast-table-numeric" :style="secondaryTextStyle">
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

			<div class="head-to-head-meetings broadcast-table-surface">
				<p v-if="firstMeeting" class="first-meeting" :style="secondaryTextStyle">
					First meeting
				</p>
				<template v-else-if="meetings.length > 0">
					<p class="meetings-title broadcast-table-header-row">
						Earlier meetings
					</p>
					<div
						v-for="meeting in meetings"
						:key="meeting.matchId"
						class="meeting broadcast-table-row"
					>
						<span class="round" :style="secondaryTextStyle">{{ meeting.roundName }}</span>
						<span class="winner" :style="primaryTextStyle">{{ winnerName(meeting) }}</span>
						<span class="score broadcast-table-numeric">{{ meeting.gameScore ?? '' }}</span>
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
	font-weight: 800;
	line-height: 1.05;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 100%;
}
.pronouns {
	font-family: var(--font-body);
	font-size: clamp(0.875rem, 1.3vw, 1.25rem);
}
.stats {
	display: flex;
	gap: 1.25rem;
	font-size: clamp(1.125rem, 2vw, 1.75rem);
	font-weight: 700;
}
.deck {
	font-size: clamp(1rem, 1.8vw, 1.5rem);
	font-weight: 600;
}
.versus {
	font-family: var(--font-mono);
	font-size: clamp(1.25rem, 2.5vw, 2rem);
	font-weight: 900;
	text-transform: uppercase;
}
.head-to-head-meetings {
	padding: 0 1.5rem 1rem;
}
.meetings-title {
	padding: 0.5rem 0;
}
.meeting {
	display: grid;
	grid-template-columns: minmax(8rem, 1fr) minmax(0, 2fr) auto;
	gap: 1rem;
	align-items: center;
	padding: 0.75rem 0;
	font-size: clamp(1rem, 1.8vw, 1.5rem);
}
.winner {
	font-weight: 700;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.score {
	font-weight: 900;
	justify-self: end;
}
.first-meeting {
	padding: 1rem 0;
	text-align: center;
	font-size: clamp(1.25rem, 2.5vw, 2rem);
	font-weight: 800;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}
</style>
