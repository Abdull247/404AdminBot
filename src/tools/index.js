import { appConfig } from '../config/load-config.js';
import { persistenceFeatureEnabled } from '../config/persistence.js';
import { getDefaultSandbox, sandboxToolNames } from '../config/sandboxes.js';
import { loadCatalog } from './catalog/load.js';
import { getEnabledTools, registerTool } from './registry.js';
import { logger } from '../utils/logger.js';

let loaded = false;

export async function initTools() {
  if (loaded) return;
  const catalog = await loadCatalog();
  for (const tool of catalog) {
    registerTool(tool.definition, tool.handler, tool.options);
  }
  loaded = true;
  logger.info({ tools: catalog.map((tool) => tool.name) }, 'tools loaded');
}

export function loadTools(context = {}) {
  if (!appConfig.tools.enabled) return [];
  const tools = getEnabledTools(appConfig.tools.allow, context);
  const sandboxTools = new Set(sandboxToolNames());
  const active = getDefaultSandbox();
  const persistenceOn = persistenceFeatureEnabled();
  return tools.filter((tool) => {
    const name = tool.function?.name;
    if (name === 'create_agent') return persistenceOn;
    if (!sandboxTools.size || !active) return true;
    if (!sandboxTools.has(name)) return true;
    return name === active.tool || name === active.id;
  });
}

export { executeToolCall } from './executor.js';
