<script lang="ts" setup>
const config = useConfigStore()
</script>

<template>
  <ConfigTournament
    v-model="config.tournamentFormData"
    :dirty="config.isDirty"
    @save="config.saveTournament"
    @reset="config.resetTournament"
  />
</template>
