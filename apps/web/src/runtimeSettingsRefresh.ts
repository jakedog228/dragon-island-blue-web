const refreshers = new Set<() => void>();

export function registerRuntimeSettingsRefresh(refresh: () => void): () => void {
  refreshers.add(refresh);
  return () => refreshers.delete(refresh);
}

export function refreshRuntimeSettingCaches(): void {
  for (const refresh of refreshers) refresh();
}
