/**
 * Restricted Hermes API-server profile for managed Botly agents.
 *
 * SECURITY: "hermes-api-server" is NOT safe: upstream expands it to terminal,
 * browser_exec, file access, code_execution and more. Use an explicit toolset
 * allowlist, and route privileged actions exclusively through Botly MCP,
 * where our approval policy executes before the operation.
 *
 * This is defence in depth. It is not a replacement for per-agent Linux UIDs
 * and is not automatically applied to the separately managed primary agent.
 */
export const RESTRICTED_API_TOOLSETS = Object.freeze([
  'mcp-botly',
  'search',
  'vision',
  'image_gen',
  'todo',
  'memory',
  'session_search',
] as const);

export const DISABLED_DIRECT_TOOLSETS = Object.freeze([
  'terminal', 'browser', 'computer_use', 'file', 'code_execution',
  'delegation', 'cronjob', 'skills', 'connections',
] as const);

export function restrictManagedProfile(config: Record<string, any>): void {
  const apiServer = RESTRICTED_API_TOOLSETS.slice();
  config.platform_toolsets = { ...(config.platform_toolsets ?? {}), api_server: apiServer };
  const agent = (config.agent && typeof config.agent === 'object') ? config.agent : {};
  const disabled = Array.isArray(agent.disabled_toolsets) ? agent.disabled_toolsets.filter((x: unknown): x is string => typeof x === 'string') : [];
  config.agent = {
    ...agent,
    disabled_toolsets: [...new Set([...disabled, ...DISABLED_DIRECT_TOOLSETS])],
  };
  // All external app operations must pass through Botly's MCP approval policy.
  // Never carry arbitrary additional MCP servers into a restricted profile.
  const botly = config.mcp_servers?.botly;
  if (!botly) throw new Error('Restricted agent has no Botly MCP gateway; refusing to start');
  config.mcp_servers = { botly };
  delete config.terminal;
  delete config.browser;
}

export function isRestrictedToolsetSafe(tools: readonly string[]): boolean {
  return tools.length === RESTRICTED_API_TOOLSETS.length &&
    tools.every((item, idx) => item === RESTRICTED_API_TOOLSETS[idx]);
}
