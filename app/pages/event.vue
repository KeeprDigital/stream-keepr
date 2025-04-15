<script lang="ts" setup>

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
        <UPageCard
          title="Event"
          variant="naked"
          orientation="horizontal"
          class="mb-4"
        >
          <UButton
            form="event"
            label="Save changes"
            color="neutral"
            type="submit"
            class="w-fit lg:ms-auto"
          />
        </UPageCard>
        <EventControl />
      </div>
    </template>
  </UDashboardPanel>
</template>
