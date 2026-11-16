/**
 * Add Browser Use support to a managed Hermes API-server profile without discarding
 * toolsets the owner has added manually.
 *
 * Hermes exposes browser_exec through the "browser" toolset, and requires
 * "terminal" in the same session. The CLI uses the already configured
 * browser.cdp_url / BROWSER_CDP_URL, so it attaches to Botly's visible Chrome.
 *
 * This is a tool-availability setting, NOT a security sandbox or approval gate.
 */
export function managedApiToolsets(existing: unknown, hasScreen: boolean, enableBrowserUse: boolean): string[] {
  const selected = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const result = new Set<string>([...selected, 'hermes-api-server']);
  if (hasScreen) result.add('computer_use');
  if (enableBrowserUse) {
    result.add('terminal');
    result.add('browser');
  }
  return [...result];
}
