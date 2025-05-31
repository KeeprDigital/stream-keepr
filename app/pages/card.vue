<script setup lang="ts">
const config = useConfigStore()
</script>

<template>
  <UDashboardPanel id="search">
    <template #header>
      <UDashboardNavbar title="Card Image" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar class="py-4">
        <MtgCardSearch v-if="config.tournamentFormData?.game === 'mtg'" class="w-full" />
        <OpCardSearch v-if="config.tournamentFormData?.game === 'op'" class="w-full" />
      </UDashboardToolbar>
    </template>
    <template #body>
      <MtgCardList v-if="config.tournamentFormData?.game === 'mtg'" />
      <OpCardList v-if="config.tournamentFormData?.game === 'op'" />
    </template>
  </UDashboardPanel>
  <UDashboardPanel
    id="controls"
    :default-size="20"
    :resizable="false"
    :ui="{
      // remove padding to give full control to the card controls
      body: 'p-0 sm:p-0',
    }"
  >
    <template #body>
      <MtgCardControls v-if="config.tournamentFormData?.game === 'mtg'" />
      <OpCardControls v-if="config.tournamentFormData?.game === 'op'" />
    </template>
  </UDashboardPanel>
</template>
