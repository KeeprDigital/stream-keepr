<template>
  <UPage
    :ui="{
      root: 'flex flex-col lg:grid lg:grid-cols-10 lg:gap-10',
      left: 'lg:col-span-2',
      center: 'lg:col-span-7',
      right: 'lg:col-span-3 order-first lg:order-last',
    }"
  >
    <UPageBody>
      <CardSearch class="card-search" />
      <CardList class="card-list" />
    </UPageBody>
    <template #right>
      <CardControls class="card-controls" />
    </template>
  </UPage>
</template>

<style scoped>
.card-search {
  display: block;
  margin: 0 auto;
  max-width: 1000px;
  margin-bottom: 1.5rem;
}

.card-list {
  margin: 0 auto;
  max-width: 1000px;
}

.card-controls {
  padding-top: 1rem;
  padding-right: 1rem;
}
</style>
