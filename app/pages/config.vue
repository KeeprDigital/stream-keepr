<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const links = [[{
  label: 'General',
  icon: 'i-lucide-settings',
  to: '/config',
  exact: true,
}, {
  label: 'Tournament',
  icon: 'i-lucide-trophy',
  to: '/config/tournament',
}, {
  label: 'Overlay',
  icon: 'i-lucide-monitor',
  to: '/config/overlay',
}, {
  label: 'Talent',
  icon: 'i-lucide-users',
  to: '/config/talent',
}]] satisfies NavigationMenuItem[][]
</script>

<template>
  <UDashboardPanel id="settings" :ui="{ body: 'lg:py-12' }">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <UNavigationMenu :items="links" highlight class="-mx-1 flex-1" />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="w-full lg:max-w-2xl mx-auto">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
