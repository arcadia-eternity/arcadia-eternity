/** Freeze copied content/schema data, including TypeBox symbol metadata. */
export function freezeContent<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) freezeContent(Reflect.get(value, key))
    Object.freeze(value)
  }
  return value
}
