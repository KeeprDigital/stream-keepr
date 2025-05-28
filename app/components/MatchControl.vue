<script lang="ts" setup>
type Props = {
  match: MatchData
  dirty: boolean
  orientation: 'horizontal' | 'vertical'
}
type Emits = {
  (e: 'update', match: MatchData): void
  (e: 'save', id: string): void
  (e: 'remove', id: string): void
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

const localMatch = ref<MatchData>(JSON.parse(JSON.stringify(props.match)))

watch(() => props.match, (newVal) => {
  localMatch.value = JSON.parse(JSON.stringify(newVal))
}, { deep: true })

function updatePlayerOne(updatedPlayer: PlayerData) {
  localMatch.value = {
    ...localMatch.value,
    playerOne: updatedPlayer,
  }
  emit('update', localMatch.value)
}

function updatePlayerTwo(updatedPlayer: PlayerData) {
  localMatch.value = {
    ...localMatch.value,
    playerTwo: updatedPlayer,
  }
  emit('update', localMatch.value)
}
</script>

<template>
  <UCard v-if="localMatch" variant="subtle">
    <div class="flex flex-row gap-4">
      <div>
        <h2 class="font-bold text-center mb-4">
          {{ orientation === 'vertical' ? 'Top Player' : 'Left Player' }}
        </h2>
        <MatchPlayerControl
          :player="localMatch.playerOne"
          @update="updatePlayerOne"
        />
      </div>
      <div>
        <USeparator orientation="vertical" />
      </div>
      <div>
        <h2 class="font-bold text-center mb-4">
          {{ orientation === 'vertical' ? 'Bottom Player' : 'Right Player' }}
        </h2>
        <MatchPlayerControl
          :player="localMatch.playerTwo"
          @update="updatePlayerTwo"
        />
      </div>
    </div>
    <div
      class="flex justify-between items-center gap-4 mt-4"
    >
      <UButton
        icon="i-heroicons-trash"
        color="error"
        variant="ghost"
        @click.stop="emit('remove', localMatch.id)"
      />
      <UButton
        color="primary"
        variant="outline"
        :disabled="!dirty"
        @click="emit('save', localMatch.id)"
      >
        Save
      </UButton>
    </div>
  </UCard>
</template>
