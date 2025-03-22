<script lang="ts" setup>
const settings = useSettingsStore()
const { loading, save } = settings
</script>

<template>
  <UDashboardPanel id="settings">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="w-full lg:max-w-2xl mx-auto">
        <UPageCard
          title="Event Settings"
          variant="naked"
          orientation="horizontal"
          class="mb-4"
        >
          <UButton
            form="settings"
            label="Save changes"
            color="neutral"
            type="submit"
            class="w-fit lg:ms-auto"
            :disabled="loading"
            @click="save"
          />
        </UPageCard>
        <EventSettings :model-value="settings.state" />
      </div>
    </template>
  </UDashboardPanel>
</template>
