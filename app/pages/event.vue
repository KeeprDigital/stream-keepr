<script setup lang="ts">
const eventStore = useEventStore()
const configStore = useConfigStore()
</script>

<template>
  <UDashboardPanel id="event" :ui="{ body: 'lg:py-12' }">
    <template #header>
      <UDashboardNavbar title="Event">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="w-full xl:max-w-2xl mx-auto">
        <EventForm
          v-model="eventStore.formData"
          :dirty="eventStore.isDirty"
          :round-options="configStore.roundOptions"
          @save="eventStore.save"
          @reset="eventStore.reset"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
