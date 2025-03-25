<script setup lang="ts">
const open = ref(false)

const links = [[{
  label: 'Home',
  icon: 'i-lucide-house',
  to: '/',
}, {
  label: 'Card Image',
  icon: 'i-lucide-book-image',
  to: '/card',
}, {
  label: 'Matches',
  icon: 'i-lucide-users',
  to: '/matches',
}, {
  label: 'Event',
  icon: 'i-lucide-calendar',
  to: '/event',
}, {
  label: 'Config',
  icon: 'i-lucide-settings',
  to: '/config',
}]]
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar
      v-model:open="open"
      collapsible
      class="bg-(--ui-bg-elevated)/25"
    >
      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
        />
      </template>
    </UDashboardSidebar>
    <slot />
  </UDashboardGroup>
</template>
