<template>
  <UDashboardPanel id="search">
    <template #header>
      <UDashboardNavbar title="Home" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar class="py-4">
        <CardSearch class="w-full" />
      </UDashboardToolbar>
    </template>
    <template #body>
      <CardList />
    </template>
  </UDashboardPanel>
  <UDashboardPanel id="controls" :default-size="15" :resizable="false">
    <template #body>
      <CardControls />
    </template>
  </UDashboardPanel>
</template>
