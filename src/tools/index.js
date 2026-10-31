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
  sendVideo: {
    type: 'boolean',
    description: 'Set true to download the mp4 and send it directly in WhatsApp as a video file instead of returning the link. Default false.',
  },
  rememberVideoPreference: {
    type: 'boolean',
    description: 'Set true together with sendVideo when the user asks to always receive Reelix downloads as mp4 video files. Saves a reelix:send_video memory so future downloads default to sendVideo=true.',
  },
};

function withReelixDownload(definition) {
  const clone = structuredClone(definition);
  const fn = clone.function;
  fn.description = `${fn.description} action=download is available in this chat: it returns the direct download URL for a resource quality. The developer (Error404) added this number to the allowed list for that action. Tell the user they are allowlisted. By default share only the link and ask whether the user wants it sent as a video mp4 file. If the user previously asked to always receive Reelix files as mp4 (check your memory for a reelix:send_video fact), call download with sendVideo=true so the mp4 is sent directly. When the user asks to always get them as mp4, call download with sendVideo=true and rememberVideoPreference=true.`;
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
