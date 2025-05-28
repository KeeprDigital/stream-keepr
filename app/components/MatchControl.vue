<script lang="ts" setup>
type Props = {
  match: MatchData
  isDirty: boolean
  deleteable: boolean
}
type Emits = {
  (e: 'update', match: MatchData): void
  (e: 'save', id: string): void
  (e: 'remove', id: string): void
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

const localMatch = ref<MatchData>(structuredClone(toRaw(props.match)))

watch(() => props.match, () => {
  localMatch.value = structuredClone(toRaw(props.match))
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
          Player 1
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
          Player 2
        </h2>
        <MatchPlayerControl
          :player="localMatch.playerTwo"
          @update="updatePlayerTwo"
        />
      </div>
    </div>
    <div
      class="flex justify-between items-center gap-4 mt-4"
      :class="deleteable ? 'justify-between' : 'justify-end'"
    >
      <UButton
        v-if="deleteable"
        icon="i-heroicons-trash"
        color="error"
        variant="ghost"
        @click.stop="emit('remove', localMatch.id)"
      />
      <UButton
        color="primary"
        variant="outline"
        :disabled="!isDirty"
        @click="emit('save', localMatch.id)"
      >
        Save
      </UButton>
    </div>
  </UCard>
</template>
