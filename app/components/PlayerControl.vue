<script setup lang="ts">
type Props = {
  title?: string
}

const props = defineProps<Props>()

const state = defineModel<PlayerData>(
  {
    default: defaultPlayerData,
  },
)
</script>

<template>
  <section class="player-control">
    <h3 v-if="props.title" class="text-center">
      {{ props.title }}
    </h3>
    <UForm class="player-control-form" :state="state">
      <UFormField label="Name" name="name">
        <UInput v-model="state.name" class="input" />
      </UFormField>
      <UFormField label="Pronouns" name="proNouns">
        <UInput v-model="state.proNouns" class="input" />
      </UFormField>
      <UFormField label="Deck" name="deck">
        <UInput v-model="state.deck" class="input" />
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
      <UFormField label="Position" name="position">
        <UInput v-model="state.position" class="input" />
      </UFormField>
    </UForm>
  </section>
</template>

<style scoped>
.player-control,
.player-control-form {
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
