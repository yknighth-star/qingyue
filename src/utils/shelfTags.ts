/** Parent folder name from a relative fs path; root-level files yield null. */
export function autoTagFromFsPath(fsPath: string): string | null {
  const parts = fsPath.split('/').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const folder = parts[parts.length - 2]
  if (!folder || folder === '.' || folder === '..') return null
  return folder
}

export function tagsWithAutoFolder(existing: string[], fsPath?: string): string[] {
  const auto = fsPath ? autoTagFromFsPath(fsPath) : null
  if (!auto) return [...existing]
  if (existing.includes(auto)) return [...existing]
  return [...existing, auto]
}
