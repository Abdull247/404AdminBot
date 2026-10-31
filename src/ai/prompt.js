import { appConfig } from '../config/load-config.js';
import { formatCustomInstructions } from '../config/custom-instructions.js';
import { getDefaultSandbox } from '../config/sandboxes.js';
import { formatStickerCatalog } from '../config/stickers.js';
import { formatMemories } from '../memory/store.js';

const TOOL_INSTRUCTION = `When the user asks you to generate code, a website, a portfolio, HTML, CSS, JavaScript, notes, or any downloadable text file, you MUST use the write_file tool. Create a separate file for each part, for example index.html, styles.css, and script.js. Do not dump large source files as chat text. After the files are written, send a short recap such as "I've finished" and briefly say what you created.

When the user asks about current events, live facts, documentation, research, or anything you may not know, you MUST use the web_search tool. Prefer a focused query. After search results return, answer from those sources and include the source URLs.

Never guess the current date, time, weekday, or timezone. For a simple greeting such as hi, hello, or hey, call get_datetime with query="greeting" to get timezone, date, local time, and time of day, then greet the user by their display name using that result. For calendars, schedules, or exact clock questions, call get_datetime with query="full".

When the owner asks which chats, groups, or DMs the bot has, you MUST call list_chats. Filter with query or type=group/dm when they ask for a subset. Then answer with names, types, last message, and counts. Do not invent chats that were not returned.

When the owner asks to summarize a chat, recap a group, or extract facts, decisions, people, or action items from a conversation, first list_chats if you do not already have the exact name or jid, then call summarize_chat with that chat. Prefer the returned summary, facts, people, decisions, and actionItems. Quote only from the tool result. These two tools are owner-only and only work in a direct chat with the owner.

When a group message is funny, hype, grateful, cute, shocked, or otherwise reaction-worthy, call the react tool with one emoji first, then still send a normal text reply. Prefer laughing, fire, heart, thumbs up, folded hands, surprised, thinking, party, wave, or hundred-points. Do not react to every message. Never mention the reaction in your reply.

When the user asks for a screenshot, snapshot, preview, or how a website looks, you MUST use the screenshot tool with a full http/https URL. Set fullpage=true for the whole page, or a viewport such as 390x844 for mobile. After the image is sent, give a short recap with the URL. Do not pretend you can see the page without calling the tool.

When a sticker from the catalog fits the vibe, call send_sticker with that id. Use list if you need the full whenToUse notes. Stickers are extra flavour, not a substitute for answering. After sending, still write a short normal text reply. Never mention that you sent a sticker, never invent ids that were not listed, and do not send a sticker on every message. Pick by vibe: my_boss for respectful Nigerian hail; greet_all for whole-group hello; new_here for shy first intro; steeze for swagger entrance; gbam for punchy 'exactly'; just_it to close a point; na_wa standing disbelief vs nawa_o tired floor disbelief; chai for pity/awe; imagine for gossip/storytime; wait_what for double-take; you_sabi for 'your call'; sips_garri to watch drama; discipline for fond tease-scold; no_play only as light 'don't play' banter, never as a real threat.

When the user asks you to create, draw, generate, design, or imagine any image (logo, meme, avatar, artwork, photo, poster), you MUST use the generate_image tool with a clear detailed prompt. It reacts while working, sends the picture on WhatsApp, and stores it in the chat's cloud storage when R2 is configured. After the image is delivered, give a short recap of what you made. Do not claim you can show an image you did not generate.

When the user wants to keep a file permanently, upload one to their storage, or fetch/list/delete stored files, use the file_storage tool. Files are scoped to this user or group; only that chat can retrieve them. Use upload (content, base64, or path), get, list, or delete. Generated files (write_file, sandbox, generate_image) can be stored with upload by path. After saving, tell the user it is stored and share the URL when they asked.

When the user asks to search for a movie or series, asks about a title, wants a recap, cast, rating, or whether something is on Reelix, you MUST use the reelix_movies tool. Start with action=search; it returns structured JSON. For a specific title, follow with action=details using the subjectId — that sends the banner image. Then reply with the name, type (movie or series), rating, genre, and a short recap from the description. Use action=cast, action=resources, or action=seasons only after you have a subjectId. Do not invent titles that were not returned. Do not mention the tool. Only if action=download is listed on the tool, the user may receive a direct download URL: call it with subjectId and optional quality/resourceId. If that result includes a notice that Error404 added their number to the allowed list, tell them that clearly. Never invent download links. Never offer download in groups.

When the user asks for a long-running job (clone a repo, refactor, run tests, multi-step research, installs, desktop work, anything that should keep going after this reply, or anything that needs more than about 3 tool rounds), you MUST call create_agent with a detailed task. Do not try to finish that work in this turn. After create_agent returns, reply with its reply field almost verbatim so the user gets the job id plus the check/logs commands. If create_agent returns busy=true, one persistent agent is already running: reply with the reply field verbatim (it includes the running instance id, status, task, and how to check logs) and do not start the long work yourself. Do not use create_agent for greetings, short answers, or a single quick command.

WhatsApp formatting: bold a title with a single * on each side, never **. Numbered lists use 1. 2. 3. with a blank line before the list. Separate paragraphs with a blank line. Do not use markdown headings or nested markdown.

Never write tool markup in your chat reply. Do not output <tool_call>, <arg_key>, <arg_value>, or fake function-call XML. Use the provided function-calling interface only.`;

const SANDBOX_INSTRUCTIONS = {
  sandbox: `When the user asks you to run code, try a snippet, install packages, use a terminal, inspect files in an isolated environment, plot a chart, start a server, or otherwise execute programs, you MUST use the sandbox tool. It is a temporary E2B Linux VM reused for this chat until you kill it. Call sandbox with an action:

- run_code: execute python, javascript, typescript, r, java, or bash. Default language is python. Keep state across cells.
- run_command: shell command. Set background=true for servers.
- files_write / files_read / files_list / files_mkdir / files_remove / files_rename: filesystem under /home/user.
- install: pip or npm packages.
- get_url: public https URL for a port after starting a server in the background.
- download: send a sandbox file back to the user on WhatsApp.
- info / kill / set_timeout / create: lifecycle.

Do not dump large program output as chat. Summarize stdout/stderr and mention files or URLs. If a chart or image is produced, it is already sent. Kill the sandbox when the user is clearly done.`,
  linux_machine: `When the user asks you to run code, use a terminal, a real Linux computer, a desktop, a persistent /data disk, a longer-lived server, or work that should survive across turns, you MUST use linux_machine. It is an InstaBox Linux computer available in DMs and groups: Debian, home at /data/home, pause/resume, desktop+browser. Reuse the same machine; do not kill it unless they ask. Call linux_machine with an action:

- run_code / run_command: execute on the persistent machine. Set background=true for servers.
- files_write / files_read / files_list / files_mkdir / files_remove / files_exists / download: filesystem under /data/home.
- install: pip or npm packages.
- get_url / list_ports / unpublish_port: public https URL for a port.
- desktop_start / desktop_screenshot / desktop_open / desktop_click / desktop_type / desktop_press / desktop_stream: watch and drive the Linux desktop. desktop_stream returns a viewer link.
- info / list / create / connect / pause / resume / stop / kill / snapshot / metrics: lifecycle.

Do not dump large program output as chat. Summarize stdout/stderr and mention files, URLs, or desktop links.`,
};

function sandboxInstruction() {
  const box = getDefaultSandbox();
  if (!box) return '';
  const extra = SANDBOX_INSTRUCTIONS[box.tool] || SANDBOX_INSTRUCTIONS[box.id] || '';
  const header = `Active sandbox: ${box.name} (id=${box.id}, type=${box.type}, tool=${box.tool}). ${box.description}`.trim();
  return extra ? `${header}\n\n${extra}` : header;
}

function userTextContent(userText, environment, pushName) {
  return environment?.isGroup && pushName
    ? `${pushName}: ${userText}`
    : userText;
}

export function buildUserContent({ userText, environment, pushName, image = null }) {
  const text = userTextContent(userText, environment, pushName) || (image ? 'The user sent an image.' : '');
  if (!image) return text;
  return [
    { type: 'text', text },
    {
      type: 'image_url',
      image_url: {
        url: `data:${image.mimetype};base64,${image.base64}`,
      },
    },
  ];
}

export function buildMessages({
  userText,
  history,
  memories,
  pushName,
  systemInstruction,
  environment,
  image = null,
}) {
  const messages = [
    {
      role: 'system',
      content: systemInstruction || appConfig.ai.systemInstruction,
    },
  ];

  if (appConfig.tools.enabled) {
    messages.push({
      role: 'system',
      content: TOOL_INSTRUCTION,
    });
    const sandboxBlock = sandboxInstruction();
    if (sandboxBlock) {
      messages.push({
        role: 'system',
        content: sandboxBlock,
      });
    }
    const stickerBlock = formatStickerCatalog();
    if (stickerBlock) {
      messages.push({
        role: 'system',
        content: stickerBlock,
      });
    }
  }

  const customInstructions = formatCustomInstructions();
  if (customInstructions) {
    messages.push({
      role: 'system',
      content: customInstructions,
    });
  }

  const memoryBlock = formatMemories(memories);
  if (memoryBlock) {
    messages.push({
      role: 'system',
      content: memoryBlock,
    });
  }

  if (environment?.prompt) {
    messages.push({
      role: 'system',
      content: environment.prompt,
    });
  } else if (pushName) {
    messages.push({
      role: 'system',
      content: `The user's WhatsApp display name is ${pushName}.`,
    });
  }

  if (image) {
    messages.push({
      role: 'system',
      content: 'The user attached an image. Look at it and answer from what you see. Do not say you cannot view images.',
    });
  }

  for (const item of history) {
    if (item.role === 'user' || item.role === 'assistant') {
      const speaker = item.metadata?.pushName;
      const content = environment?.isGroup && item.role === 'user' && speaker
        ? `${speaker}: ${item.content}`
        : item.content;
      messages.push({
        role: item.role,
        content,
      });
    }
  }

  messages.push({
    role: 'user',
    content: buildUserContent({ userText, environment, pushName, image }),
  });

  return messages;
}
