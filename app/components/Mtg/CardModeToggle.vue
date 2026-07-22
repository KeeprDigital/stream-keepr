<script setup lang="ts">
import type { CardPageMode } from '~/types/card/page';

const props = withDefaults(defineProps<{
	matchDecklistDisabled?: boolean;
	playerDecklistDisabled?: boolean;
}>(), {
	matchDecklistDisabled: false,
	playerDecklistDisabled: false,
});
const mode = defineModel<CardPageMode>({ required: true });
</script>

<template>
	<UFieldGroup size="xl">
		<UButton
			icon="i-lucide-search"
			:color="mode === 'search' ? 'primary' : 'neutral'"
			:variant="mode === 'search' ? 'subtle' : 'outline'"
			aria-label="Card search mode"
			@click="() => { mode = 'search' }"
		/>
		<UButton
			icon="i-lucide-swords"
			:color="mode === 'match-decklist' ? 'primary' : 'neutral'"
			:variant="mode === 'match-decklist' ? 'subtle' : 'outline'"
			:disabled="props.matchDecklistDisabled"
			aria-label="Feature match deck list mode"
			@click="() => { mode = 'match-decklist' }"
		/>
		<UButton
			icon="i-lucide-user"
			:color="mode === 'player-decklist' ? 'primary' : 'neutral'"
			:variant="mode === 'player-decklist' ? 'subtle' : 'outline'"
			:disabled="props.playerDecklistDisabled"
			aria-label="Player deck list mode"
			@click="() => { mode = 'player-decklist' }"
		/>
	</UFieldGroup>
</template>
