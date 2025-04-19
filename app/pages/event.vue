<script setup lang="ts">
const eventStore = useEventStore()
</script>

<template>
  <UDashboardPanel id="event">
    <template #header>
      <UDashboardNavbar title="Event">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="w-full lg:max-w-2xl mx-auto">
        <EventControl
          v-model="eventStore.state"
          :loading="eventStore.loading"
          @save="eventStore.save"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
