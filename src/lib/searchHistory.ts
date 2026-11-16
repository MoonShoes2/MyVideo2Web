const KEY = 'zy.searchHistory'
const MAX = 12

export function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  } catch {
    return []
  }
}

function save(list: string[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

/** 最新的排最前，重复搜索把旧记录提前；最多留 12 条。 */
export function addSearchKeyword(keyword: string): string[] {
  const trimmed = keyword.trim()
  if (!trimmed) return loadSearchHistory()
  const next = [trimmed, ...loadSearchHistory().filter((k) => k !== trimmed)].slice(0, MAX)
  save(next)
  return next
}

export function removeSearchKeyword(keyword: string): string[] {
  const next = loadSearchHistory().filter((k) => k !== keyword)
  save(next)
  return next
}

export function clearSearchHistory(): string[] {
  save([])
  return []
}
