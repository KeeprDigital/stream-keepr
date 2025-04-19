<script setup lang="ts">
import type { PlayerData } from '~~/shared/schemas/player'

const player = defineModel<PlayerData>({ required: true })
</script>

<template>
  <UForm :state="player" class="w-full flex flex-col gap-4">
    <div class="flex gap-4">
      <UFormField label="Name" name="name" class="flex-2/3">
        <UInput v-model="player.name" class="w-full" />
      </UFormField>
      <UFormField label="Pronouns" name="proNouns" class="flex-1/3">
        <UInput v-model="player.proNouns" class="w-full" />
      </UFormField>
    </div>
    <UFormField label="Deck" name="deck" class="w-full">
      <UInput v-model="player.deck" class="w-full" />
    </UFormField>
    <div class="flex gap-4">
      <UFormField label="Wins" name="wins" class="w-full">
        <UInput v-model="player.score.wins" class="w-full" />
      </UFormField>
      <UFormField label="Losses" name="losses" class="w-full">
        <UInput v-model="player.score.losses" class="w-full" />
      </UFormField>
      <UFormField label="Draws" name="draws" class="w-full">
        <UInput v-model="player.score.draws" class="w-full" />
      </UFormField>
    </div>
    <UFormField label="Position" name="position" class="w-full">
      <UInput v-model="player.position" class="w-full" />
    </UFormField>
  </UForm>
</template>
