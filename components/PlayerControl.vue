<script setup lang="ts">
import { type Player, playerSchema } from '~/types/overlay'

const state = defineModel<Player>(
  {
    default: {
      name: '',
      deck: '',
      position: '',
      score: {
        wins: 0,
        losses: 0,
        draws: 0,
      },
    },
  },
)
</script>

<template>
  <UForm class="player-control" :state="state" :schema="playerSchema">
    <UFormField label="Name" name="name">
      <UInput v-model="state.name" class="input" />
    </UFormField>
    <UFormField label="Pronouns" name="proNouns">
      <UInput v-model="state.proNouns" class="input" />
    </UFormField>
    <UFormField label="Deck" name="deck">
      <UInput v-model="state.deck" class="input" />
    </UFormField>
    <UFormField label="Position" name="position">
      <UInput v-model="state.position" class="input" />
    </UFormField>
    <div class="score">
      <UFormField class="score-field" label="Wins" name="wins">
        <UInput v-model="state.score.wins" class="input" />
      </UFormField>
      <UFormField class="score-field" label="Losses" name="losses">
        <UInput v-model="state.score.losses" class="input" />
      </UFormField>
      <UFormField class="score-field" label="Draws" name="draws">
        <UInput v-model="state.score.draws" class="input" />
      </UFormField>
    </div>
  </UForm>
</template>

<style scoped>
.player-control {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  .score {
    display: flex;
    flex-direction: row;
    gap: 1rem;

    .score-field {
      width: 100%;
    }
  }

  .input {
    width: 100%;
  }
}
</style>
