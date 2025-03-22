<script setup lang="ts">
const items = [
  {
    label: 'Match 1',
  },
  {
    label: 'Match 2',
  },
  {
    label: 'Match 3',
  },
]
</script>

<template>
  <UDashboardPanel id="matches">
    <template #header>
      <UDashboardNavbar title="Matches">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAccordion :items="items" type="multiple">
        <template #body="{ item }">
          <div class="flex flex-row gap-4">
            <PlayerControl title="Player 1" />
            <PlayerControl title="Player 2" />
          </div>
        </template>
      </UAccordion>
    </template>
  </UDashboardPanel>
</template>
