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
          :model-value="config.state"
          :loading="config.loading"
          @save="config.save"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
