<script lang="ts" setup>
const config = useConfigStore()
</script>

<template>
  <ConfigTalent
    v-model="config.talentFormData"
    :dirty="config.isDirty"
    @save="config.saveTalent"
    @reset="config.resetTalent"
  />
</template>
