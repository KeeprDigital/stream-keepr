<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { PlayerSlotData } from '~~/shared/api';
import type { FeatureMatchAssignment, Match, Player } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';

const props = defineProps<{
	match: Match;
	players: Player[];
	featureMatchLabel: string | null;
	featureMatchAssignment?: FeatureMatchAssignment | null;
	featureMatchMenuItems: DropdownMenuItem[][];
	promoting: boolean;
	resultsEditable: boolean;
}>();

const emit = defineEmits<{
	promote: [featureMatchId: number];
	viewDeckList: [player: Player];
	editResult: [match: Match];
	assignmentNoteBlur: [assignmentId: number, note: string];
}>();

const { getActiveDeckForPlayer } = usePlayerDeckCache();

const assignmentNote = computed(() => props.featureMatchAssignment?.note ?? '');
const assignmentNotePreview = computed(() => assignmentNote.value.trim());
const hasAssignmentNote = computed(() => assignmentNotePreview.value.length > 0);
const matchRowClasses = computed(() => ({
	'match-row--featured': !!props.featureMatchAssignment,
	'match-row--has-note': hasAssignmentNote.value,
}));

function saveAssignmentNote(note: string) {
	if (!props.featureMatchAssignment)
		return;
	emit('assignmentNoteBlur', props.featureMatchAssignment.id, note);
}

// ── Player Resolution ──

function findPlayer(playerId: number | null): Player | null {
	if (!playerId)
		return null;
	return props.players.find(p => p.id === playerId) ?? null;
}

const player1 = computed(() => findPlayer(props.match.player1Id));
const player2 = computed(() => findPlayer(props.match.player2Id));

const player1HasDeckList = computed(() => !!getMtgGameData(player1.value?.gameData).deckName);
const player2HasDeckList = computed(() => !!getMtgGameData(player2.value?.gameData).deckName);
const player1GameWins = computed(() => props.match.player1GameWins ?? 0);
const player2GameWins = computed(() => props.match.player2GameWins ?? 0);

// ── Deck Resolution ──

function getDeckForCurrentPhase(
	playerId: number | null,
	playerData: PlayerSlotData | null | undefined,
): { name: string | null; colors: string | null } {
	const defaultName = playerData?.gameData?.type === 'mtg' ? playerData.gameData.deckName ?? null : null;
	const defaultColors = playerData?.gameData?.type === 'mtg' ? playerData.gameData.deckColors ?? null : null;
	if (!playerId)
		return { name: defaultName, colors: defaultColors };
	const player = findPlayer(playerId);
	if (!player)
		return { name: defaultName, colors: defaultColors };
	const deck = getActiveDeckForPlayer(player);
	return deck ? { name: deck.name, colors: deck.colors } : { name: defaultName, colors: defaultColors };
}

const player1Deck = computed(() =>
	getDeckForCurrentPhase(props.match.player1Id, props.match.player1Data),
);

const player2Deck = computed(() =>
	getDeckForCurrentPhase(props.match.player2Id, props.match.player2Data),
);

// ── Record Formatting ──

function getPlayerRecordData(
	playerId: number | null,
	playerData: PlayerSlotData | null | undefined,
): Pick<PlayerSlotData, 'wins' | 'losses' | 'draws'> | null {
	if (playerData?.wins != null || playerData?.losses != null || playerData?.draws != null) {
		return playerData;
	}

	const player = findPlayer(playerId);
	if (!player)
		return null;

	if (player.wins == null && player.losses == null && player.draws == null)
		return null;

	return player;
}

function formatRecord(recordData: Pick<PlayerSlotData, 'wins' | 'losses' | 'draws'> | null): string | null {
	if (!recordData)
		return null;
	return `${recordData.wins ?? 0}-${recordData.losses ?? 0}-${recordData.draws ?? 0}`;
}

const player1Record = computed(() => getPlayerRecordData(props.match.player1Id, props.match.player1Data));
const player2Record = computed(() => getPlayerRecordData(props.match.player2Id, props.match.player2Data));

// ── Bye Detection ──

const isBye = computed(() => !props.match.player2Data && !props.match.player2Id);
const isDraw = computed(() => props.match.hasResult && player1GameWins.value === player2GameWins.value);
const winnerSide = computed<'player1' | 'player2' | null>(() => {
	if (!props.match.hasResult || isDraw.value) {
		return null;
	}
	if (player1GameWins.value > player2GameWins.value) {
		return 'player1';
	}
	if (player2GameWins.value > player1GameWins.value) {
		return 'player2';
	}
	return null;
});

function getPlayerResultClasses(side: 'player1' | 'player2') {
	if (!props.match.hasResult) {
		return 'font-medium text-default';
	}
	if (isDraw.value) {
		return 'font-medium text-muted';
	}

	return winnerSide.value === side
		? 'font-semibold text-primary'
		: 'font-medium text-muted';
}

function getScoreColor(side: 'player1' | 'player2') {
	if (isDraw.value) {
		return 'info';
	}

	return winnerSide.value === side ? 'success' : 'neutral';
}
</script>

<template>
	<div class="match-row" :class="matchRowClasses">
		<!-- Bye: span all columns, centered -->
		<template v-if="isBye">
			<UBadge
				class="match-bye-badge"
				color="neutral"
				variant="outline"
				size="md"
			>
				Bye
			</UBadge>
			<div class="match-bye-player-wrap">
				<div class="match-player-stack match-bye-player items-center">
					<span class="font-medium truncate">{{ match.player1Data?.name || 'TBD' }}</span>
					<span v-if="formatRecord(player1Record)" class="text-xs font-mono text-muted">{{ formatRecord(player1Record) }}</span>
					<div v-if="player1Deck.name" class="flex items-center gap-1.5">
						<MtgManaColorDisplay
							v-if="player1Deck.colors"
							:colors="player1Deck.colors"
							size="xs"
						/>
						<button
							v-if="player1HasDeckList"
							type="button"
							class="flex items-center gap-1 text-sm text-muted hover:text-primary transition-colors cursor-pointer truncate"
							title="View Deck List"
							@click="emit('viewDeckList', player1!)"
						>
							<UIcon name="i-lucide-list" class="w-3.5 h-3.5 shrink-0" />
							<span class="truncate">{{ player1Deck.name }}</span>
						</button>
						<span v-else class="text-sm text-muted truncate">
							{{ player1Deck.name }}
						</span>
					</div>
				</div>
			</div>
		</template>

		<!-- Normal match -->
		<template v-else>
			<!-- Left column: badges + player 1 -->
			<div class="match-left">
				<UBadge color="neutral" variant="subtle" size="md">
					{{ match.tableNumber }}
				</UBadge>
				<UBadge
					v-if="featureMatchLabel"
					color="primary"
					variant="solid"
					size="md"
				>
					<UIcon name="i-lucide-star" class="size-3" />
					{{ featureMatchLabel }}
				</UBadge>
				<UBadge
					v-if="hasAssignmentNote"
					color="warning"
					variant="subtle"
					size="md"
					title="This featured match has production notes"
				>
					<UIcon name="i-lucide-sticky-note" class="size-3" />
					Note
				</UBadge>
				<div class="match-player-stack items-end">
					<div class="flex items-center justify-end gap-2 min-w-0">
						<span data-testid="player1-name" class="truncate" :class="getPlayerResultClasses('player1')">{{ match.player1Data?.name || 'TBD' }}</span>
						<UBadge
							v-if="match.hasResult"
							data-testid="player1-score"
							size="sm"
							variant="subtle"
							:color="getScoreColor('player1')"
						>
							{{ player1GameWins }}
						</UBadge>
					</div>
					<span v-if="formatRecord(player1Record)" class="text-xs font-mono text-muted">{{ formatRecord(player1Record) }}</span>
					<div v-if="player1Deck.name" class="flex items-center gap-1.5 justify-end min-w-0">
						<MtgManaColorDisplay
							v-if="player1Deck.colors"
							:colors="player1Deck.colors"
							size="xs"
						/>
						<button
							v-if="player1HasDeckList"
							type="button"
							class="flex items-center gap-1 text-sm text-muted hover:text-primary transition-colors cursor-pointer truncate"
							title="View Deck List"
							@click="emit('viewDeckList', player1!)"
						>
							<UIcon name="i-lucide-list" class="w-3.5 h-3.5 shrink-0" />
							<span class="truncate">{{ player1Deck.name || '-' }}</span>
						</button>
						<span v-else class="text-sm text-muted truncate">
							{{ player1Deck.name }}
						</span>
					</div>
				</div>
			</div>

			<!-- Center gap -->
			<div class="match-gap" />

			<!-- Right column: player 2 + action -->
			<div class="match-right">
				<div class="match-player-stack items-start">
					<div class="flex items-center gap-2 min-w-0">
						<UBadge
							v-if="match.hasResult"
							data-testid="player2-score"
							size="sm"
							variant="subtle"
							:color="getScoreColor('player2')"
						>
							{{ player2GameWins }}
						</UBadge>
						<span data-testid="player2-name" class="truncate" :class="getPlayerResultClasses('player2')">{{ match.player2Data?.name || 'TBD' }}</span>
					</div>
					<span v-if="formatRecord(player2Record)" class="text-xs font-mono text-muted">{{ formatRecord(player2Record) }}</span>
					<div v-if="player2Deck.name" class="flex items-center gap-1.5 justify-start min-w-0">
						<button
							v-if="player2HasDeckList"
							type="button"
							class="flex items-center gap-1 text-sm text-muted hover:text-primary transition-colors cursor-pointer truncate"
							title="View Deck List"
							@click="emit('viewDeckList', player2!)"
						>
							<UIcon name="i-lucide-list" class="w-3.5 h-3.5 shrink-0" />
							<span class="truncate">{{ player2Deck.name || '-' }}</span>
						</button>
						<span v-else class="text-sm text-muted truncate">
							{{ player2Deck.name }}
						</span>
						<MtgManaColorDisplay
							v-if="player2Deck.colors"
							:colors="player2Deck.colors"
							size="xs"
						/>
					</div>
				</div>
				<div v-if="hasAssignmentNote" class="match-note-preview" :title="assignmentNotePreview">
					<UIcon name="i-lucide-sticky-note" class="size-3.5 shrink-0" />
					<span class="truncate">{{ assignmentNotePreview }}</span>
				</div>
				<UButton
					v-if="resultsEditable && !isBye"
					class="match-action-button"
					size="xs"
					variant="ghost"
					color="neutral"
					@click="emit('editResult', match)"
				>
					{{ match.hasResult ? 'Edit Result' : 'Enter Result' }}
				</UButton>
				<MatchNotePopover
					v-if="featureMatchAssignment"
					:note="assignmentNote"
					:note-key="featureMatchAssignment.id"
					content-align="end"
					@save="saveAssignmentNote"
				>
					<UButton
						:icon="hasAssignmentNote ? 'i-lucide-sticky-note' : 'i-lucide-message-square-plus'"
						:color="hasAssignmentNote ? 'primary' : 'neutral'"
						:variant="hasAssignmentNote ? 'soft' : 'ghost'"
						size="sm"
						class="match-action-button"
						:aria-label="hasAssignmentNote ? 'Edit feature match note' : 'Add feature match note'"
						:title="hasAssignmentNote ? 'Edit feature match note' : 'Add feature match note'"
					/>
				</MatchNotePopover>
				<UDropdownMenu
					:items="featureMatchMenuItems"
					:content="{ align: 'end' }"
					:disabled="featureMatchMenuItems.length === 0"
					:ui="{ item: 'items-center' }"
				>
					<UButton
						icon="i-lucide-tv"
						color="neutral"
						variant="ghost"
						size="sm"
						class="match-action-button"
						:loading="promoting"
						:disabled="featureMatchMenuItems.length === 0"
						aria-label="Send to feature match"
					/>

					<template #item-label="{ item }">
						<div class="flex flex-col gap-0.5">
							<span class="font-medium">{{ item.label }}</span>
							<div v-if="item.player1DeckName || item.player2DeckName" class="flex items-center gap-1 text-xs text-muted">
								<template v-if="item.player1DeckName">
									<MtgManaColorDisplay v-if="item.player1Colors" :colors="item.player1Colors" size="xs" />
									<span>{{ item.player1DeckName }}</span>
								</template>
								<template v-if="item.player1DeckName && item.player2DeckName">
									<span class="text-dimmed">vs</span>
								</template>
								<template v-if="item.player2DeckName">
									<MtgManaColorDisplay v-if="item.player2Colors" :colors="item.player2Colors" size="xs" />
									<span>{{ item.player2DeckName }}</span>
								</template>
							</div>
						</div>
					</template>
				</UDropdownMenu>
			</div>
		</template>
	</div>
</template>

<style scoped>
.match-row {
	display: grid;
	grid-template-columns: subgrid;
	grid-column: 1 / -1;
	align-items: center;
	padding: 0.625rem 0;
	border-radius: 0.75rem;
}

.match-row--featured {
	background: color-mix(in srgb, var(--ui-primary) 7%, transparent);
	box-shadow: inset 0.25rem 0 0 var(--ui-primary);
}

.match-row--has-note {
	background: color-mix(in srgb, var(--ui-warning) 8%, transparent);
	box-shadow: inset 0.25rem 0 0 var(--ui-warning);
}

.match-left {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.match-right {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.match-note-preview {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	max-width: 12rem;
	min-width: 0;
	padding: 0.25rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ui-warning) 35%, transparent);
	border-radius: 9999px;
	color: var(--ui-warning);
	background: color-mix(in srgb, var(--ui-warning) 12%, transparent);
	font-size: 0.75rem;
	line-height: 1rem;
}

.match-player-stack {
	display: flex;
	flex-direction: column;
	flex: 1;
	gap: 0.125rem;
	min-width: 0;
}

.match-action-button {
	width: 2rem;
	height: 2rem;
	justify-content: center;
}

.match-bye-badge {
	grid-column: 1 / 2;
	grid-row: 1;
	justify-self: start;
}

.match-bye-player-wrap {
	display: grid;
	grid-column: 1 / -1;
	grid-row: 1;
	justify-items: center;
	min-width: 0;
}

.match-bye-player {
	align-items: center;
	text-align: center;
	max-width: min(100%, 28rem);
}
</style>
