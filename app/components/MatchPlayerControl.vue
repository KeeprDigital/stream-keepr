<script setup lang="ts">
type Props = {
  player: PlayerData
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update', player: PlayerData): void
}>()

const localPlayer = ref<PlayerData>({ ...props.player })

watch(() => props.player, (newPlayer) => {
  localPlayer.value = { ...newPlayer }
}, { deep: true })

function updateField(field: keyof PlayerData, value: string) {
  localPlayer.value = {
    ...localPlayer.value,
    [field]: value,
  }
  emit('update', localPlayer.value)
}

function updateScore(field: keyof PlayerData['score'], value: number) {
  localPlayer.value = {
    ...localPlayer.value,
    score: {
      ...localPlayer.value.score,
      [field]: value,
    },
  }
  emit('update', localPlayer.value)
}
</script>

<template>
  <UForm :state="localPlayer" class="w-full flex flex-col gap-4">
    <div class="flex gap-4">
      <UFormField label="Name" name="name" class="flex-2/3">
        <UInput
          :model-value="localPlayer.name"
          class="w-full"
          @update:model-value="updateField('name', $event)"
        />
      </UFormField>
      <UFormField label="Pronouns" name="proNouns" class="flex-1/3">
        <UInput
          :model-value="localPlayer.proNouns"
          class="w-full"
          @update:model-value="updateField('proNouns', $event)"
        />
      </UFormField>
    </div>
    <UFormField label="Deck" name="deck" class="w-full">
      <UInput
        :model-value="localPlayer.deck"
        class="w-full"
        @update:model-value="updateField('deck', $event)"
      />
    </UFormField>
    <div class="flex gap-4">
      <UFormField label="Wins" name="wins" class="w-full">
        <UInput
          :model-value="localPlayer.score.wins"
          class="w-full"
          @update:model-value="updateScore('wins', $event)"
        />
      </UFormField>
      <UFormField label="Losses" name="losses" class="w-full">
        <UInput
          :model-value="localPlayer.score.losses"
          class="w-full"
          @update:model-value="updateScore('losses', $event)"
        />
      </UFormField>
      <UFormField label="Draws" name="draws" class="w-full">
        <UInput
          :model-value="localPlayer.score.draws"
          class="w-full"
          @update:model-value="updateScore('draws', $event)"
        />
      </UFormField>
    </div>
    <UFormField label="Position" name="position" class="w-full">
      <UInput
        :model-value="localPlayer.position"
        class="w-full"
        @update:model-value="updateField('position', $event)"
      />
    </UFormField>
  </UForm>
</template>
