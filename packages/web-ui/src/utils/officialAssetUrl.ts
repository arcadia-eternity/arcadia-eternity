/** Only the official CDN assets are mirrored by build:static; user pack URLs keep their own origin. */
export function officialAssetUrl(url: string): string {
  if (import.meta.env.VITE_STATIC_MODE !== '1') return url
  const resourceOrigin = 'https://seer2-resource.yuuinih.com/'
  const petOrigin = 'https://seer2-pet-resource.yuuinih.com/'
  const relative = url.startsWith(resourceOrigin)
    ? `resource/${url.slice(resourceOrigin.length)}`
    : url.startsWith(petOrigin)
      ? `pet/${url.slice(petOrigin.length)}`
      : null
  if (!relative) return url
  // Static builds use hash routes, so document.baseURI remains at the deployed directory.
  return new URL(`${import.meta.env.BASE_URL}official-assets/${relative}`, document.baseURI).href
}
