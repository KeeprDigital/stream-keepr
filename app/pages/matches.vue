<script setup lang="ts">
const matchStore = useMatchStore()
const configStore = useConfigStore()
</script>

<template>
  <UDashboardPanel id="matches" :ui="{ body: 'lg:py-12' }">
    <template #header>
      <UDashboardNavbar title="Matches">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            variant="ghost"
            icon="i-lucide-plus"
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
            v-for="(match) in matchStore.formData"
            :key="match.id"
            :match="match"
            :dirty="matchStore.isDirty(match.id)"
            :orientation="configStore.overlay.matchOrientation"
            @update="matchStore.updateMatch"
            @save="matchStore.saveMatch"
            @remove="matchStore.removeMatch"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
