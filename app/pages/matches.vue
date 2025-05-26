<script setup lang="ts">
const matchStore = useMatchStore()
</script>

<template>
  <UDashboardPanel id="matches">
    <template #header>
      <UDashboardNavbar title="Matches">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            variant="ghost"
            icon="i-heroicons-plus"
            color="primary"
            @click="matchStore.addMatch"
          >
            Add Match
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="w-full lg:max-w-2xl mx-auto">
        <div class="flex flex-col gap-4 mb-4">
          <MatchControl
            v-for="match in matchStore.state"
            :key="match.id"
            :match="match"
            @update="matchStore.updateMatch"
            @save="matchStore.saveMatch"
            @remove="matchStore.removeMatch"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
