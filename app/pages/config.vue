<script lang="ts" setup>
const config = useConfigStore()
</script>

<template>
  <UDashboardPanel id="config">
    <template #header>
      <UDashboardNavbar title="Config">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="w-full lg:max-w-2xl mx-auto">
        <EventConfig
          v-model="config.state"
          :loading="!config.loaded"
          @save="config.save"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
