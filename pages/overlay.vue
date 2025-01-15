<script setup lang="ts">
const overlayStore = useOverlayStore()

await overlayStore.loadState()

async function save() {
  await overlayStore.saveState()
}

function reset() {
  overlayStore.reset()
}
</script>

<template>
  <UPage>
    <UPageBody class="overlay-controls-body">
      <div class="overlay-controls">
        <div class="overlay-controls-players">
          <UCard>
            <template #header>
              <h3>Top Player</h3>
            </template>
            <PlayerControl v-model="overlayStore.overlayState.topPlayer" />
          </UCard>
          <UCard>
            <template #header>
              <h3>Bottom Player</h3>
            </template>
            <PlayerControl v-model="overlayStore.overlayState.bottomPlayer" />
          </UCard>
        </div>
        <UCard>
          <template #header>
            <h3>Event</h3>
          </template>
          <EventControl v-model="overlayStore.overlayState.event" />
        </UCard>
      </div>
      <div class="overlay-controls-buttons">
        <UButton
          size="xl"
          variant="outline"
          @click="save"
        >
          Update
        </UButton>
        <UButton
          size="xl"
          color="warning"
          variant="outline"
          @click="reset"
        >
          Reset
        </UButton>
      </div>
    </UPageBody>
  </UPage>
</template>

<style scoped>
.overlay-controls-body {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.overlay-controls-players {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.overlay-controls {
  display: flex;
  flex-direction: row;
  gap: 2rem;
}
</style>
