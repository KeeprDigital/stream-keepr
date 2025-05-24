export function getStore<T extends Topic>(store: T) {
  const storage = useStorage('local').getItem<TopicData<T>>(store)
  return storage
}

export function setStore<T extends Topic>(store: T, data: TopicData<T>) {
  useStorage('local').setItem(store, data)
}

export function clearStore<T extends Topic>(store: T) {
  useStorage('local').removeItem(store)
}
