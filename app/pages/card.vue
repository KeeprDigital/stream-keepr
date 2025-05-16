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
        <MtgCardSearch v-if="config.state.game === 'mtg'" class="w-full" />
        <OpCardSearch v-if="config.state.game === 'op'" class="w-full" />
      </UDashboardToolbar>
    </template>
    <template #body>
      <MtgCardList v-if="config.state.game === 'mtg'" />
      <OpCardList v-if="config.state.game === 'op'" />
    </template>
  </UDashboardPanel>
  <UDashboardPanel id="controls" :default-size="15" :resizable="false">
    <template #body>
      <MtgCardControls v-if="config.state.game === 'mtg'" />
      <OpCardControls v-if="config.state.game === 'op'" />
    </template>
  </UDashboardPanel>
</template>
