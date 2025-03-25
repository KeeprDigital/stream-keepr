<script lang="ts" setup>
const config = useConfigStore()
const { loading, save } = config
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
        <UPageCard
          title="Event Config"
          variant="naked"
          orientation="horizontal"
          class="mb-4"
        >
          <UButton
            form="config"
            label="Save changes"
            color="neutral"
            type="submit"
            class="w-fit lg:ms-auto"
            :disabled="loading"
            @click="save"
          />
        </UPageCard>
        <EventConfig :model-value="config.state" />
      </div>
    </template>
  </UDashboardPanel>
</template>
