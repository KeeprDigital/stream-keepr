<script setup lang="ts">
import type { BracketPosition, ManualBracket, ManualBracketEntrant, ManualBracketResult, TopCutBracketSize } from '~~/shared/modules/top-cut-bracket';
import {
	deriveManualTopCutBracket,
	manualBracketSeedsAt,
	resizeManualBracket,
	withManualBracketEntrant,
	withManualBracketResult,
} from '~~/shared/modules/top-cut-bracket';
import { MANUAL_BRACKET_ENTRANT_NAME_MAX, MANUAL_BRACKET_GAME_WINS_MAX, TOP_CUT_BRACKET_SIZES } from '~~/shared/screenModeConfigs/topCut';
import { playerLabel, playerMatchesSearch } from '~~/shared/utils/playerName';

/**
 * A Manual Bracket's editor (ADR-0075): its size, its entrants in Seed order,
 * each a Player of the Event or a typed name, and who advanced from each
 * position that seats two entrants, with an optional game score. Every edit
 * writes the whole Manual Bracket.
 */
const props = defineProps<{
	manual: ManualBracket;
}>();

const emit = defineEmits<{
	update: [manual: ManualBracket];
}>();

const playerStore = usePlayerStore();

const sizeOptions = TOP_CUT_BRACKET_SIZES.map(size => ({ label: `Top ${size}`, value: size }));

const seeds = computed(() => Array.from({ length: props.manual.size }, (_, index) => index + 1));

function playerName(playerId: number): string | null {
	const player = playerStore.players.find(candidate => candidate.id === playerId);
	return player
		? playerLabel(player)
		: null;
}

function entrantName(entrant: ManualBracketEntrant): string | null {
	return 'playerId' in entrant
		? playerName(entrant.playerId)
		: entrant.name;
}

/** An entrant as the picker names it: `player:<id>`, or `name:<typed name>`. */
function entrantKey(entrant: ManualBracketEntrant | null | undefined): string | undefined {
	if (!entrant)
		return undefined;
	return 'playerId' in entrant
		? `player:${entrant.playerId}`
		: `name:${entrant.name}`;
}

function entrantOfKey(key: string): ManualBracketEntrant | null {
	if (key.startsWith('player:')) {
		return {
			playerId: Number(key.slice('player:'.length)),
		};
	}
	const name = key.slice('name:'.length).trim().slice(0, MANUAL_BRACKET_ENTRANT_NAME_MAX);
	return name
		? { name }
		: null;
}

// Each Seed's picker finds a Player by name, Nickname or Bandai member number, or takes what was typed as a name.
const searches = ref<Record<number, string>>({});

function seedItems(seed: number): Array<{ label: string; id: string }> {
	const search = searches.value[seed] ?? '';
	const items: Array<{ label: string; id: string }> = playerStore.players
		.filter(player => playerMatchesSearch(player, search))
		.map(player => ({
			label: playerLabel(player),
			id: `player:${player.id}`,
		}));
	const held = props.manual.entrants[seed - 1];
	if (held && 'name' in held) {
		items.unshift({
			label: held.name,
			id: entrantKey(held)!,
		});
	}
	const typed = search.trim();
	if (typed && !items.some(item => item.label === typed))
		items.push({ label: `Use “${typed}” as a name`, id: `name:${typed}` });
	return items;
}

function setEntrant(seed: number, key: string | null | undefined) {
	searches.value = { ...searches.value, [seed]: '' };
	emit('update', withManualBracketEntrant(props.manual, seed, key
		? entrantOfKey(key)
		: null));
}

function setSize(size: TopCutBracketSize) {
	emit('update', resizeManualBracket(props.manual, size));
}

// The bracket as it will show, so each position offers its result once it seats two entrants.
const bracket = computed(() => deriveManualTopCutBracket(props.manual, (entrant, seed) => {
	const name = entrantName(entrant);
	return name == null
		? null
		: {
				playerId: 'playerId' in entrant
					? entrant.playerId
					: null,
				name,
				seed,
			};
}));

function seedLabel(position: number, side: 0 | 1): string {
	return `Seed ${manualBracketSeedsAt(props.manual.size, position)[side]}`;
}

function sideName(position: BracketPosition, side: 0 | 1): string {
	return position.entrants[side]?.name ?? (position.status === 'bye'
		? 'Bye'
		: 'TBD');
}

function resultAt(column: number, position: number): ManualBracketResult | null {
	return props.manual.results[column]?.[position] ?? null;
}

function setWinner(column: number, position: number, winner: 0 | 1) {
	const held = resultAt(column, position);
	const next = held?.winner === winner
		? null
		: { winner, gameWins: held?.gameWins ?? null };
	emit('update', withManualBracketResult(props.manual, column, position, next));
}

function gameWinsOf(column: number, position: number, side: 0 | 1): number | undefined {
	return resultAt(column, position)?.gameWins?.[side];
}

function setGameWins(column: number, position: number, side: 0 | 1, value: string | number | null | undefined) {
	const held = resultAt(column, position);
	if (!held)
		return;
	const wins = Number(value);
	const clamped = value === '' || value == null || !Number.isFinite(wins)
		? null
		: Math.min(Math.max(Math.trunc(wins), 0), MANUAL_BRACKET_GAME_WINS_MAX);
	const current = held.gameWins ?? [0, 0];
	const gameWins: [number, number] | null = clamped == null
		? null
		: side === 0
			? [clamped, current[1]]
			: [current[0], clamped];
	emit('update', withManualBracketResult(props.manual, column, position, { winner: held.winner, gameWins }));
}

/** A position takes a result once it seats both its entrants. */
function decidable(position: BracketPosition): boolean {
	return position.status === 'reported' || position.status === 'unreported';
}
</script>

<template>
	<div class="flex flex-col gap-5" data-testid="manual-bracket-editor">
		<ScreenSettingsField
			label="Bracket size"
			name="manualBracket.size"
			description="Changing the size keeps each entrant's Seed and clears every result."
		>
			<USelect
				:model-value="manual.size"
				:items="sizeOptions"
				class="w-64"
				@update:model-value="setSize($event)"
			/>
		</ScreenSettingsField>

		<fieldset class="flex flex-col gap-2" data-field="manualBracket.entrants">
			<legend class="text-sm font-medium">
				Entrants
			</legend>
			<p class="text-xs text-muted">
				List the top cut in Seed order; the bracket pairs them 1v8, 4v5, 2v7, 3v6. A Seed left empty is a bye. Pick a Player, or type a name.
			</p>
			<ol class="flex flex-col gap-2">
				<li
					v-for="seed in seeds"
					:key="seed"
					class="flex items-center gap-2"
					:data-seed="seed"
				>
					<span class="w-8 text-xs text-muted tabular-nums">{{ seed }}</span>
					<UInputMenu
						v-model:search-term="searches[seed]"
						:data-testid="`manual-bracket-seed-${seed}`"
						:model-value="entrantKey(manual.entrants[seed - 1])"
						:items="seedItems(seed)"
						ignore-filter
						value-key="id"
						icon="i-lucide-user-search"
						:placeholder="`Seed ${seed}…`"
						class="w-64"
						@update:model-value="setEntrant(seed, $event)"
					/>
					<UButton
						v-if="manual.entrants[seed - 1]"
						:data-testid="`manual-bracket-clear-seed-${seed}`"
						icon="i-lucide-x"
						color="neutral"
						variant="ghost"
						size="xs"
						:aria-label="`Clear Seed ${seed}`"
						@click="setEntrant(seed, null)"
					/>
				</li>
			</ol>
		</fieldset>

		<fieldset class="flex flex-col gap-2" data-field="manualBracket.results">
			<legend class="text-sm font-medium">
				Results
			</legend>
			<p class="text-xs text-muted">
				Pick who advanced from each match; the next round fills in. Add a game score if you want one shown.
			</p>
			<div class="flex flex-col gap-4">
				<section
					v-for="(column, columnIndex) in bracket.columns"
					:key="columnIndex"
					:data-column="columnIndex"
					class="flex flex-col gap-2"
				>
					<h4 class="text-xs font-medium text-muted">
						{{ column.name }}
					</h4>
					<div
						v-for="(position, positionIndex) in column.positions"
						:key="positionIndex"
						class="flex flex-wrap items-center gap-2"
						:data-position="positionIndex"
						:data-status="position.status"
					>
						<template v-if="decidable(position)">
							<template v-for="side in ([0, 1] as const)" :key="side">
								<span v-if="side === 1" class="text-xs text-muted">vs</span>
								<UButton
									:data-testid="`manual-bracket-winner-${columnIndex}-${positionIndex}-${side}`"
									:aria-pressed="String(position.winner === side)"
									:color="position.winner === side ? 'primary' : 'neutral'"
									:variant="position.winner === side ? 'solid' : 'outline'"
									size="xs"
									:label="sideName(position, side)"
									@click="setWinner(columnIndex, positionIndex, side)"
								/>
							</template>
							<template v-if="position.winner != null">
								<UInput
									v-for="side in ([0, 1] as const)"
									:key="`score-${side}`"
									:data-testid="`manual-bracket-score-${columnIndex}-${positionIndex}-${side}`"
									:model-value="gameWinsOf(columnIndex, positionIndex, side)"
									:aria-label="`${sideName(position, side)} games won`"
									type="number"
									:min="0"
									:max="MANUAL_BRACKET_GAME_WINS_MAX"
									size="xs"
									class="w-14"
									:model-modifiers="{ lazy: true }"
									@update:model-value="setGameWins(columnIndex, positionIndex, side, $event)"
								/>
							</template>
						</template>
						<span v-else class="text-xs text-muted">
							<template v-if="columnIndex === 0">
								{{ position.entrants[0]?.name ?? seedLabel(positionIndex, 0) }} vs {{ position.entrants[1]?.name ?? seedLabel(positionIndex, 1) }}
							</template>
							<template v-else>
								{{ sideName(position, 0) }} vs {{ sideName(position, 1) }}
							</template>
							<template v-if="position.status === 'bye'"> · advances on a bye</template>
						</span>
					</div>
				</section>
			</div>
		</fieldset>
	</div>
</template>
