<script lang="ts" setup>
const props = defineProps<{
  id: string
}>()

const matchStore = useMatchStore()
const match = matchStore.state.find(match => match.id === props.id)

if (!match) {
  throw new Error('Match not found')
}

watch(match, () => {
  matchStore.updateMatch(match)
}, { deep: true })
</script>

<template>
  <UCard variant="subtle">
    <div class="flex flex-row gap-4">
      <div>
        <h2 class="font-bold text-center mb-4">
          Player 1
        </h2>
        <MatchPlayerControl v-model="match.playerOne" />
      </div>
      <div>
        <USeparator orientation="vertical" />
      </div>
      <div>
        <h2 class="font-bold text-center mb-4">
          Player 2
        </h2>
        <MatchPlayerControl v-model="match.playerTwo" />
      </div>
    </div>
    <div class="flex justify-between items-center gap-4 mt-4">
      <UButton
        icon="i-heroicons-trash"
        color="error"
        variant="ghost"
        @click.stop="matchStore.removeMatch(match.id)"
      />
      <UButton
        color="primary"
        variant="outline"
        @click="matchStore.saveMatch(match.id)"
      >
        Save
      </UButton>
    </div>
  </UCard>
</template>
