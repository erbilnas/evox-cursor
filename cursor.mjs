import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const TITLE_LIMIT = 18;
export const ALIVE_MS = 8000;
export const PENDING_MS = 25000;
export const WAIT_MS = 20000;
export const HEARTBEAT_MS = 3000;
export const STATUS_POLL_MS = 1000;
export const USAGE_POLL_MS = 180000;
export const USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
export const REQUEST_USAGE_URL = 'https://api2.cursor.sh/auth/usage';
export const PLAN_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo';

const THINKING_EVENTS = new Set([
  'sessionStart',
  'beforeSubmitPrompt',
  'afterAgentThought',
  'postToolUse',
  'postToolUseFailure',
  'afterShellExecution',
  'afterMCPExecution',
  'afterFileEdit',
  'subagentStart',
  'subagentStop',
]);

const IDLE_EVENTS = new Set(['stop', 'sessionEnd']);
const PHASE_TITLE = {
  idle: 'Idle',
  working: 'Working',
  thinking: 'Thinking',
  reading: 'Reading',
  editing: 'Editing',
  running: 'Running',
  answer: 'Answer',
};
const PERMISSION_EVENTS = new Set(['beforeShellExecution', 'beforeMCPExecution', 'preToolUse']);

export function bridgeDir(userDataDir, home = homedir(), platform = process.platform) {
  return path.join(resolveUserDataDir(userDataDir, home, platform), 'evox-deck');
}

export function resolveUserDataDir(userDataDir, home = homedir(), platform = process.platform) {
  return expandPath(userDataDir, home) || defaultUserDataDir(platform, home);
}

export function userDataDirFromCommand(command) {
  const text = String(command || '');
  const match = text.match(/--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (!match) return '';
  return match[1] || match[2] || match[3] || '';
}

export function matchingCursorPid(text, userDataDir, home = homedir(), platform = process.platform) {
  const target = path.resolve(resolveUserDataDir(userDataDir, home, platform));
  const fallback = path.resolve(defaultUserDataDir(platform, home));
  const rows = String(text || '').split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match || !match[2].includes('Cursor')) return [];
    return [{ pid: match[1], command: match[2] }];
  });
  const exact = rows.find((row) => {
    const dir = userDataDirFromCommand(row.command);
    return dir && path.resolve(dir) === target;
  });
  if (exact) return exact.pid;
  if (target !== fallback) return '';
  const plain = rows.find((row) => !userDataDirFromCommand(row.command) && /\/MacOS\/Cursor(?:\s|$)/.test(row.command));
  return plain?.pid || '';
}

export function clampTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= TITLE_LIMIT) return text;
  return `${text.slice(0, TITLE_LIMIT - 3)}...`;
}

export function isFresh(stamp, now, maxAge) {
  const at = Number(stamp);
  return Number.isFinite(at) && now - at >= 0 && now - at <= maxAge;
}

export function isDeckAlive(alive, now = Date.now()) {
  return isFresh(alive?.at, now, ALIVE_MS);
}

export function isFreshPending(pending, now = Date.now()) {
  return Boolean(pending?.id) && isFresh(pending.at, now, PENDING_MS);
}

export function statusTitle(status, pending, now = Date.now()) {
  if (isFreshPending(pending, now)) return clampTitle(pending.label) || 'Needs you';
  return PHASE_TITLE[status?.phase] || 'Idle';
}

export function isQuestion(input) {
  return /askquestion/i.test(String(input?.tool_name || '').replace(/[^a-z]/gi, ''));
}

export function looksLikeQuestion(text) {
  return String(text || '').trim().endsWith('?');
}

export function toolPhase(eventName, input) {
  const tool = String(input?.tool_name || '');
  if (isQuestion(input)) return 'answer';
  if (eventName === 'beforeShellExecution' || tool === 'Shell') return 'running';
  if (tool === 'Read' || tool === 'Grep') return 'reading';
  if (/write|edit|strreplace|apply/i.test(tool)) return 'editing';
  if (eventName === 'preToolUse' || eventName === 'beforeMCPExecution') return 'working';
  return null;
}

export function nextPhase(eventName, input) {
  if (eventName === 'afterAgentResponse') return looksLikeQuestion(input?.text) ? 'answer' : null;
  if (IDLE_EVENTS.has(eventName)) return 'idle';
  if (THINKING_EVENTS.has(eventName)) return 'thinking';
  return toolPhase(eventName, input);
}

export function isPermissionEvent(eventName) {
  return PERMISSION_EVENTS.has(eventName);
}

export function pendingLabel(input) {
  const command = typeof input?.command === 'string' ? input.command : '';
  const tool = typeof input?.tool_name === 'string' ? input.tool_name : '';
  const nested = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : '';
  return clampTitle(command || nested || tool) || 'Needs you';
}

export function acceptVerb(input) {
  const eventName = String(input?.hook_event_name || '');
  const tool = String(input?.tool_name || '');
  if (eventName === 'beforeShellExecution' || tool === 'Shell') return 'Run';
  if (eventName === 'beforeMCPExecution' || /^mcp[:_-]/i.test(tool)) return 'Allow';
  return 'Approve';
}

export function skipsDeck(input) {
  if (String(input?.hook_event_name || '') !== 'preToolUse') return false;
  const tool = String(input?.tool_name || '');
  return tool === 'Shell' || tool === 'Read' || tool === 'Grep' || /^mcp[:_-]/i.test(tool);
}

export function matchedDecision(pending, decision) {
  if (!pending?.id || !decision || decision.id !== pending.id) return null;
  if (decision.permission !== 'allow' && decision.permission !== 'deny') return null;
  return decision.permission;
}

export function permissionOutcome({ deckAlive, decision, timedOut }) {
  if (!deckAlive || timedOut || !decision) return { permission: 'ask' };
  if (decision === 'deny') {
    return {
      permission: 'deny',
      user_message: 'Denied from the deck',
      agent_message: 'The user denied this from the Stream Deck.',
    };
  }
  return { permission: 'allow' };
}

export function remainingPercent(body) {
  const plan = body?.planUsage;
  if (!plan || typeof plan !== 'object') return null;
  const auto = finite(plan.autoPercentUsed);
  const api = finite(plan.apiPercentUsed);
  if (auto != null && api != null) return clampPercent((auto + api) / 2);
  const limit = finite(plan.limit);
  let remaining = finite(plan.remaining);
  const included = finite(plan.includedSpend);
  if (limit != null && limit > 0) {
    if (remaining == null && included != null) remaining = limit - included;
    if (remaining != null) return clampPercent((remaining / limit) * 100);
  }
  const used = finite(plan.totalPercentUsed);
  if (used == null) return null;
  return clampPercent(100 - used);
}

export function includedRemaining(period, planInfo) {
  if (!period?.billingCycleStart || period.planUsage) return null;
  const included = finite(planInfo?.includedAmountCents ?? planInfo?.includedAmount);
  if (included == null || included <= 0) return null;
  return 100;
}

export function requestRemainingPercent(body) {
  if (!body || typeof body !== 'object') return null;
  let tightest = null;
  for (const value of Object.values(body)) {
    if (!value || typeof value !== 'object') continue;
    const max = finite(value.maxRequestUsage);
    const used = finite(value.numRequests);
    if (max == null || max <= 0 || used == null) continue;
    const remaining = clampPercent((1 - used / max) * 100);
    if (tightest == null || remaining < tightest) tightest = remaining;
  }
  return tightest;
}

export function soundChoice(value) {
  if (value === 'off' || value === 'ring') return value;
  return 'once';
}

export function usageLabel(value) {
  if (value === 'signed-out') return 'Sign in';
  if (typeof value !== 'number') return 'Usage ?';
  return `${value}%`;
}

export function expandPath(value, home, { allowEmpty = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return allowEmpty ? '' : null;
  if (text.includes('\0')) return null;
  const expanded = text === '~' ? home : text.startsWith('~/') ? path.join(home, text.slice(2)) : text;
  if (!path.isAbsolute(expanded)) return null;
  return expanded;
}

export function defaultUserDataDir(platform, home) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cursor');
  if (platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Cursor');
  return path.join(home, '.config', 'Cursor');
}

export function profileArgs(userDataDir, workspace, home) {
  const dir = expandPath(userDataDir, home);
  if (!dir) return null;
  const args = ['--new-window', '--user-data-dir', dir];
  if (String(workspace ?? '').trim()) {
    const folder = expandPath(workspace, home);
    if (!folder) return null;
    args.push(folder);
  }
  return args;
}

export function folderTitle(userDataDir, home) {
  const dir = expandPath(userDataDir, home);
  if (!dir) return 'Profile';
  return clampTitle(path.basename(dir)) || 'Profile';
}

export function profileLabel(name, userDataDir, home) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (text) return clampTitle(text);
  return folderTitle(userDataDir, home);
}

export function infoPatch(eventName, input) {
  const patch = {};
  const root = Array.isArray(input?.workspace_roots) ? input.workspace_roots.find((item) => item) : '';
  if (root) patch.project = path.basename(root);
  if (typeof input?.model === 'string' && input.model.trim()) patch.model = input.model.trim();
  if (eventName === 'afterFileEdit' && typeof input?.file_path === 'string' && input.file_path.trim()) {
    patch.file = input.file_path.trim();
    patch.fileName = path.basename(patch.file);
  }
  return patch;
}

export function shortModel(model) {
  const text = String(model || '').toLowerCase();
  const known = ['opus', 'sonnet', 'haiku', 'composer', 'gpt', 'gemini', 'grok', 'codex', 'kimi'];
  const hit = known.find((name) => text.includes(name));
  if (hit) return hit;
  const tail = text.split(/[^a-z0-9.]+/).filter(Boolean).pop();
  return tail || 'model';
}

export function modelList(text) {
  return String(text || '').split(',').map((item) => item.trim()).filter((item) => /^[A-Za-z0-9._-]+$/.test(item));
}

export function cycleModel(list, current) {
  if (!list.length) return '';
  const index = list.findIndex((item) => item.toLowerCase() === String(current || '').toLowerCase());
  return list[(index + 1) % list.length];
}

export function composerPreference(raw, slug) {
  let body = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    body = {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  body.composer = slug;
  return JSON.stringify(body);
}

export function hotkeyScript(spec) {
  const parts = String(spec || '').toLowerCase().split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.find((part) => !['cmd', 'command', 'shift', 'alt', 'option', 'ctrl', 'control'].includes(part));
  if (!key || !/^[a-z0-9]$/.test(key)) return '';
  const modifiers = [];
  if (parts.some((part) => part === 'cmd' || part === 'command')) modifiers.push('command down');
  if (parts.includes('shift')) modifiers.push('shift down');
  if (parts.some((part) => part === 'alt' || part === 'option')) modifiers.push('option down');
  if (parts.some((part) => part === 'ctrl' || part === 'control')) modifiers.push('control down');
  const using = modifiers.length ? ` using {${modifiers.join(', ')}}` : '';
  return `tell application "System Events" to keystroke "${key}"${using}`;
}

export function rotateStep(payload) {
  const delta = Number(payload?.delta);
  if (Number.isFinite(delta) && delta !== 0) return delta > 0 ? 1 : -1;
  if (payload?.direction === 'LEFT') return -1;
  if (payload?.direction === 'RIGHT') return 1;
  return 0;
}

export function stateDbPath(userDataDir, home, platform) {
  const dir = expandPath(userDataDir, home) || defaultUserDataDir(platform, home);
  return path.join(dir, 'User', 'globalStorage', 'state.vscdb');
}

export function parseToken(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.startsWith('"')) {
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === 'string' ? parsed.trim() : '';
    } catch {
      return '';
    }
  }
  if (/\s/.test(text)) return '';
  return text;
}

export function newPending(input, now = Date.now()) {
  return { id: randomUUID(), label: pendingLabel(input), verb: acceptVerb(input), at: now };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

function bridgeFile(name, userDataDir) {
  return path.join(bridgeDir(userDataDir), name);
}

export async function readAlive(home) {
  return readJson(bridgeFile('alive.json', home));
}

export async function readStatus(home) {
  return readJson(bridgeFile('status.json', home));
}

export async function readInfo(userDataDir) {
  return readJson(bridgeFile('info.json', userDataDir));
}

export async function patchInfo(userDataDir, fields) {
  const clean = Object.fromEntries(Object.entries(fields || {}).filter(([, value]) => value));
  if (!Object.keys(clean).length) return null;
  const current = await readInfo(userDataDir) || {};
  const next = { ...current, ...clean, at: Date.now() };
  await writeJson(bridgeFile('info.json', userDataDir), next);
  return next;
}

export async function readPending(home) {
  return readJson(bridgeFile('pending.json', home));
}

export async function readDecision(home) {
  return readJson(bridgeFile('decision.json', home));
}

export async function writeAlive(home, now = Date.now()) {
  await writeJson(bridgeFile('alive.json', home), { at: now });
}

export async function clearAlive(home) {
  await rm(bridgeFile('alive.json', home), { force: true });
}

export async function writeStatus(home, phase, now = Date.now()) {
  await writeJson(bridgeFile('status.json', home), { phase, at: now });
}

export async function writePending(home, pending) {
  await writeJson(bridgeFile('pending.json', home), pending);
}

export async function writeDecision(home, id, permission) {
  await writeJson(bridgeFile('decision.json', home), { id, permission });
}

export const CARRY_MS = 3000;

export function isFreshCarry(carry, now = Date.now()) {
  return isFresh(carry?.at, now, CARRY_MS);
}

export async function readCarry(home) {
  return readJson(bridgeFile('carry.json', home));
}

export async function writeCarry(home, now = Date.now()) {
  await writeJson(bridgeFile('carry.json', home), { at: now });
}

export async function clearCarry(home) {
  await rm(bridgeFile('carry.json', home), { force: true });
}

export async function clearIfId(home, name, id) {
  const file = bridgeFile(name, home);
  const current = await readJson(file);
  if (!current || current.id !== id) return;
  await rm(file, { force: true });
}

// ponytail: unofficial dashboard RPCs. If none of them include a limit, the key shows "Usage ?".
export async function fetchUsage(userDataDir, home = homedir(), platform = process.platform) {
  const token = await readAccessToken(stateDbPath(userDataDir, home, platform));
  if (!token) return 'signed-out';
  try {
    const period = await usageRequest(token, USAGE_URL, '{}');
    const fromPlan = period ? remainingPercent(period) : null;
    if (typeof fromPlan === 'number') return fromPlan;
    const fromRequests = requestRemainingPercent(await usageRequest(token, REQUEST_USAGE_URL));
    if (typeof fromRequests === 'number') return fromRequests;
    const plan = await usageRequest(token, PLAN_URL, '{}');
    const info = plan?.planInfo && typeof plan.planInfo === 'object' ? plan.planInfo : plan;
    return includedRemaining(period, info);
  } catch {
    return null;
  }
}

async function usageRequest(token, url, body) {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
    },
    body,
  });
  if (!response.ok) return null;
  return response.json();
}

async function readAccessToken(db) {
  try {
    const { stdout } = await execFileAsync('sqlite3', [
      '-readonly',
      db,
      'SELECT value FROM ItemTable WHERE key = \'cursorAuth/accessToken\';',
    ], { timeout: 5000 });
    return parseToken(stdout);
  } catch {
    return '';
  }
}

export async function launchProfile(userDataDir, workspace, home = homedir()) {
  const args = profileArgs(userDataDir, workspace, home);
  if (!args) return false;
  const bin = process.env.CURSOR_BIN || (process.platform === 'darwin' ? '/usr/local/bin/cursor' : 'cursor');
  await execFileAsync(bin, args, { timeout: 15000 });
  return true;
}

export async function detectUserDataDir(home = homedir(), platform = process.platform) {
  let pid = process.ppid;
  const seen = new Set();
  for (let i = 0; i < 12 && pid > 1 && !seen.has(pid); i += 1) {
    seen.add(pid);
    let command = '';
    let parent = 0;
    try {
      command = (await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)], { timeout: 2000 })).stdout;
      parent = Number((await execFileAsync('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 2000 })).stdout);
    } catch {
      break;
    }
    const found = userDataDirFromCommand(command);
    if (found) return found;
    if (!Number.isFinite(parent) || parent === pid) break;
    pid = parent;
  }
  return defaultUserDataDir(platform, home);
}

export async function cursorPid(userDataDir, home = homedir(), platform = process.platform) {
  const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,command='], { timeout: 2000 });
  return matchingCursorPid(stdout, userDataDir, home, platform);
}

export async function openInProfile(userDataDir, target, home = homedir()) {
  const args = ['--reuse-window', '--user-data-dir', resolveUserDataDir(userDataDir, home)];
  if (target) args.push(target);
  const bin = process.env.CURSOR_BIN || (process.platform === 'darwin' ? '/usr/local/bin/cursor' : 'cursor');
  await execFileAsync(bin, args, { timeout: 15000 });
}

export async function setComposerModel(userDataDir, slug, home = homedir(), platform = process.platform) {
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) return false;
  const db = stateDbPath(userDataDir, home, platform);
  try {
    const { stdout } = await execFileAsync('sqlite3', [
      '-readonly',
      db,
      "SELECT value FROM ItemTable WHERE key = 'cursor/lastSingleModelPreference';",
    ], { timeout: 5000 });
    const value = composerPreference(stdout.trim(), slug).replaceAll("'", "''");
    const key = 'cursor/lastSingleModelPreference';
    const update = await execFileAsync('sqlite3', [
      db,
      `UPDATE ItemTable SET value = '${value}' WHERE key = '${key}'; SELECT changes();`,
    ], { timeout: 5000 });
    if (Number(update.stdout) > 0) return true;
    await execFileAsync('sqlite3', [
      db,
      `INSERT INTO ItemTable (key, value) VALUES ('${key}', '${value}');`,
    ], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
