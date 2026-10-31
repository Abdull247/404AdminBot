import { appConfig } from '../config/load-config.js';
import { persistenceFeatureEnabled } from '../config/persistence.js';
import { getDefaultSandbox, sandboxToolNames } from '../config/sandboxes.js';
import { canAccessReelixDownload } from './catalog/reelix-movies/access.js';
import { loadCatalog } from './catalog/load.js';
import { getEnabledTools, registerTool } from './registry.js';
import { logger } from '../utils/logger.js';

const DOWNLOAD_ACTION = 'search | details | resources | cast | seasons | download. Default search. action=download returns the direct quality URL and is only listed for allowlisted DMs.';
const PUBLIC_ACTION = 'search | details | resources | cast | seasons. Default search.';

const DOWNLOAD_PARAMS = {
  resourceId: {
    type: 'string',
    description: 'Resource id from a resources listing. Optional for action=download.',
  },
  quality: {
    type: 'string',
    description: 'Desired quality for action=download, for example 720p or 1080p.',
  },
  resolution: {
    type: 'integer',
    description: 'Desired resolution for action=download, for example 720 or 1080.',
  },
};

function withReelixDownload(definition) {
  const clone = structuredClone(definition);
  const fn = clone.function;
  fn.description = `${fn.description} action=download is available in this chat: it returns the direct download URL for a resource quality. The developer (Error404) added this number to the allowed list for that action. Tell the user they are allowlisted.`;
  const props = fn.parameters?.properties || {};
  if (props.action) props.action.description = DOWNLOAD_ACTION;
  if (props.subjectId) {
    props.subjectId.description = 'Numeric Reelix subject id from a search result. Required for details, resources, cast, seasons, and download.';
  }
  Object.assign(props, DOWNLOAD_PARAMS);
  return clone;
}

function withoutReelixDownload(definition) {
  const props = definition?.function?.parameters?.properties;
  if (!props) return definition;
  const clone = structuredClone(definition);
  const next = clone.function.parameters.properties;
  if (next.action) next.action.description = PUBLIC_ACTION;
  delete next.resourceId;
  delete next.quality;
  delete next.resolution;
  return clone;
}

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
  const downloads = canAccessReelixDownload(context);
  return tools.filter((tool) => {
    const name = tool.function?.name;
    if (name === 'create_agent') return persistenceOn;
    if (!sandboxTools.size || !active) return true;
    if (!sandboxTools.has(name)) return true;
    return name === active.tool || name === active.id;
  }).map((tool) => {
    if (tool.function?.name !== 'reelix_movies') return tool;
    return downloads ? withReelixDownload(tool) : withoutReelixDownload(tool);
  });
}

export { executeToolCall } from './executor.js';
