import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { EvoxPluginClient } from '@evoxapp/plugin-sdk';
import { createNodeProcessIpcPluginTransport } from '@evoxapp/plugin-sdk/node';
import { keyView, rasterImage } from './lcd.mjs';
import {
  HEARTBEAT_MS,
  STATUS_POLL_MS,
  USAGE_POLL_MS,
  fetchUsage,
  profileLabel,
  isFreshPending,
  launchProfile,
  cursorPid,
  readInfo,
  readPending,
  readStatus,
  shortModel,
  soundChoice,
  statusTitle,
  usageLabel,
  clearAlive,
  cycleModel,
  hotkeyScript,
  modelList,
  openInProfile,
  patchInfo,
  setComposerModel,
  rotateStep,
  writeAlive,
  writeDecision,
} from './cursor.mjs';

const execFileAsync = promisify(execFile);
const STATIC_TITLES = {
  approve: 'Allow',
  deny: 'Deny',
  stop: 'Stop',
};
const SCOPED = new Set(['status', 'approve', 'deny', 'stop', 'usage', 'project', 'model', 'file', 'chat']);
const INFO_ACTIONS = new Set(['project', 'model', 'file']);

const client = new EvoxPluginClient(createNodeProcessIpcPluginTransport(), {
  sdkVersion: '0.2.0',
  onError: (error) => console.error(`[sdk] ${error?.code || 'error'}`),
});

const bindings = new Map();
const dirs = new Map();
const shown = new Map();
const heard = new Set();
const profileIndex = new Map();
let ringTimer = null;
let ringFor = '';
let ringBusy = false;
let timer = null;
let heartAt = 0;
let usageAt = 0;
let chain = Promise.resolve();

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(() => {}, () => {});
  return run;
}

function bindingId(event) {
  return event.context?.bindingInstanceId || '';
}

function actionId(event) {
  return event.context?.actionId || '';
}

function dataDir(id) {
  return dirs.get(id) || '';
}

function scopedDirs() {
  const values = [];
  for (const [id, action] of bindings) {
    if (SCOPED.has(action) && !values.includes(dataDir(id))) values.push(dataDir(id));
  }
  return values;
}

async function paint(id, action, title) {
  const view = keyView(action, title);
  const signature = `${view.kind}|${view.label}`;
  if (shown.get(id) === signature) return;
  try {
    await client.setTitle(id, '').catch(() => {});
    await client.setImage(id, rasterImage(view));
    shown.set(id, signature);
  } catch (error) {
    console.error(`[cursor] image ${error?.code || 'failed'}`);
  }
}

async function settingsFor(id, event) {
  if (event?.payload?.settings) return event.payload.settings;
  return client.getSettings(id).catch(() => ({}));
}

async function refreshProfiles(event) {
  for (const [id, action] of bindings) {
    if (action !== 'profile') continue;
    const settings = id === bindingId(event || {}) ? await settingsFor(id, event) : await client.getSettings(id).catch(() => ({}));
    await paint(id, 'profile', profileLabel(settings.name, settings.userDataDir, homedir()));
  }
}

async function refreshStatus() {
  const now = Date.now();
  const titles = new Map();
  for (const [id, action] of bindings) {
    if (action !== 'status') continue;
    const dir = dataDir(id);
    if (!titles.has(dir)) {
      titles.set(dir, statusTitle(await readStatus(dir), await readPending(dir), now));
    }
    await paint(id, 'status', titles.get(dir));
  }
}

async function refreshApprovals() {
  const verbs = new Map();
  for (const [id, action] of bindings) {
    if (action !== 'approve') continue;
    const dir = dataDir(id);
    if (!verbs.has(dir)) {
      const pending = await readPending(dir);
      verbs.set(dir, isFreshPending(pending) ? pending.verb || 'Allow' : 'Allow');
    }
    await paint(id, 'approve', verbs.get(dir));
  }
}

async function refreshUsage() {
  const labels = new Map();
  for (const [id, action] of bindings) {
    if (action !== 'usage') continue;
    const dir = dataDir(id);
    if (!labels.has(dir)) labels.set(dir, usageLabel(await fetchUsage(dir)));
    await paint(id, 'usage', labels.get(dir) || 'Usage ?');
  }
}

async function refreshInfo() {
  const infos = new Map();
  for (const [id, action] of bindings) {
    if (!INFO_ACTIONS.has(action)) continue;
    const dir = dataDir(id);
    if (!infos.has(dir)) infos.set(dir, await readInfo(dir) || {});
    const info = infos.get(dir);
    if (action === 'project') await paint(id, action, info.project || 'Project');
    if (action === 'model') await paint(id, action, shortModel(info.model));
    if (action === 'file') await paint(id, action, info.fileName || 'File');
  }
}

function stopRing() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  ringFor = '';
  ringBusy = false;
}

function playSound(name) {
  if (process.platform !== 'darwin' || ringBusy) return;
  ringBusy = true;
  execFileAsync('afplay', [`/System/Library/Sounds/${name}.aiff`]).catch(() => {}).finally(() => {
    ringBusy = false;
  });
}

async function waitingSound() {
  for (const [id, action] of bindings) {
    if (action !== 'status') continue;
    const settings = await client.getSettings(id).catch(() => ({}));
    return soundChoice(settings.sound);
  }
  return 'once';
}

async function chime() {
  const mode = await waitingSound();
  const seen = new Set();
  let active = '';
  for (const dir of scopedDirs()) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const pending = await readPending(dir);
    if (!isFreshPending(pending)) continue;
    active = pending.id;
    break;
  }
  if (!active || mode === 'off') {
    stopRing();
    return;
  }
  if (mode === 'once') {
    stopRing();
    if (heard.has(active)) return;
    heard.add(active);
    playSound('Glass');
    return;
  }
  if (ringFor === active && ringTimer) return;
  stopRing();
  ringFor = active;
  playSound('Ping');
  ringTimer = setInterval(() => {
    if (ringFor === active) playSound('Ping');
  }, 2000);
}

async function profileChoices() {
  const choices = [];
  for (const [id, action] of bindings) {
    if (action !== 'profile') continue;
    const settings = await client.getSettings(id).catch(() => ({}));
    if (!settings?.userDataDir) continue;
    choices.push(settings);
  }
  return choices;
}

async function paintKnob(id) {
  const choices = await profileChoices();
  if (!choices.length) {
    await paint(id, 'profiles', 'Profile');
    return choices;
  }
  const index = ((profileIndex.get(id) || 0) % choices.length + choices.length) % choices.length;
  profileIndex.set(id, index);
  const choice = choices[index];
  await paint(id, 'profiles', profileLabel(choice.name, choice.userDataDir, homedir()));
  return choices;
}

function ensureTimer() {
  if (timer || bindings.size === 0) return;
  timer = setInterval(() => {
    enqueue(async () => {
      const now = Date.now();
      if (now - heartAt >= HEARTBEAT_MS) {
        heartAt = now;
        for (const dir of scopedDirs()) await writeAlive(dir);
      }
      await refreshStatus();
      await refreshApprovals();
      await refreshInfo();
      await chime();
      if (now - usageAt >= USAGE_POLL_MS) {
        usageAt = now;
        await refreshUsage();
      }
    }).catch((error) => console.error(`[cursor] ${error?.message || 'refresh failed'}`));
  }, STATUS_POLL_MS);
}

function stopTimer() {
  if (!timer || bindings.size > 0) return;
  clearInterval(timer);
  timer = null;
}

async function focusCursor(userDataDir, sendEscape) {
  if (process.platform !== 'darwin') throw new Error('unsupported');
  const pid = await cursorPid(userDataDir);
  if (!/^\d+$/.test(pid)) throw new Error('missing');
  const lines = [
    `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
  ];
  if (sendEscape) lines.push('tell application "System Events" to key code 53');
  await execFileAsync('osascript', lines.flatMap((line) => ['-e', line]));
}

async function answer(id, permission) {
  const dir = dataDir(id);
  const pending = await readPending(dir);
  if (!isFreshPending(pending)) {
    await client.showError(id);
    return;
  }
  await writeDecision(dir, pending.id, permission);
  await client.showSuccess(id);
}

async function openSelected(id) {
  const choices = await paintKnob(id);
  const choice = choices[profileIndex.get(id) || 0];
  if (!choice) {
    await client.showError(id);
    return;
  }
  const opened = await launchProfile(choice.userDataDir, choice.workspace);
  if (!opened) {
    await client.showError(id);
    return;
  }
  await client.showSuccess(id);
}

client.on('action.willAppear', (event) => enqueue(async () => {
  const id = bindingId(event);
  const action = actionId(event);
  if (!id || !action) return;
  bindings.set(id, action);
  dirs.set(id, String(event.payload?.settings?.userDataDir || ''));
  if (STATIC_TITLES[action]) await paint(id, action, STATIC_TITLES[action]);
  if (action === 'profile') await paint(id, action, profileLabel(event.payload?.settings?.name, event.payload?.settings?.userDataDir, homedir()));
  if (action === 'chat') await paint(id, action, 'New');
  if (action === 'profiles') await paintKnob(id);
  ensureTimer();
  if (SCOPED.has(action)) await writeAlive(dataDir(id));
  heartAt = Date.now();
  if (action === 'status') await refreshStatus();
  if (action === 'approve') await refreshApprovals();
  if (INFO_ACTIONS.has(action)) await refreshInfo();
  if (action === 'usage') {
    usageAt = Date.now();
    await refreshUsage();
  }
}));

client.on('action.willDisappear', (event) => {
  const id = bindingId(event);
  bindings.delete(id);
  dirs.delete(id);
  shown.delete(id);
  profileIndex.delete(id);
  stopTimer();
});

client.on('action.settingsChanged', (event) => enqueue(async () => {
  const id = bindingId(event);
  const action = actionId(event);
  if (id && event.payload?.settings) dirs.set(id, String(event.payload.settings.userDataDir || ''));
  if (action === 'profile') await refreshProfiles(event);
  if (action === 'status') await refreshStatus();
  if (action === 'approve') await refreshApprovals();
  if (INFO_ACTIONS.has(action)) await refreshInfo();
  if (action === 'usage') await refreshUsage();
}));

client.on('action.keyDown', (event) => enqueue(async () => {
  const id = bindingId(event);
  const action = actionId(event);
  try {
    if (action === 'status') {
      await focusCursor(dataDir(id), false);
      await client.showSuccess(id);
      return;
    }
    if (action === 'approve' || action === 'deny') {
      await answer(id, action === 'approve' ? 'allow' : 'deny');
      return;
    }
    if (action === 'profile') {
      const settings = await settingsFor(id, event);
      const opened = await launchProfile(settings.userDataDir, settings.workspace);
      if (!opened) {
        await client.showError(id);
        return;
      }
      await client.showSuccess(id);
      return;
    }
    if (action === 'usage') {
      usageAt = Date.now();
      await refreshUsage();
      await client.showSuccess(id);
      return;
    }
    if (action === 'stop') {
      await focusCursor(dataDir(id), true);
      await client.showSuccess(id);
      return;
    }
    if (action === 'project') {
      await focusCursor(dataDir(id), false);
      await client.showSuccess(id);
      return;
    }
    if (action === 'file') {
      const info = await readInfo(dataDir(id));
      if (!info?.file) {
        await client.showError(id);
        return;
      }
      await openInProfile(dataDir(id), info.file);
      await client.showSuccess(id);
      return;
    }
    if (action === 'model') {
      const settings = await settingsFor(id, event);
      const info = await readInfo(dataDir(id)) || {};
      const next = cycleModel(modelList(settings.models), info.model);
      if (!next) {
        await client.showError(id);
        return;
      }
      const saved = await setComposerModel(dataDir(id), next);
      await patchInfo(dataDir(id), { model: next });
      await refreshInfo();
      if (!saved) {
        await client.showError(id);
        return;
      }
      await client.showSuccess(id);
      return;
    }
    if (action === 'chat') {
      const settings = await settingsFor(id, event);
      const script = hotkeyScript(settings.hotkey || 'cmd+n');
      if (!script) {
        await client.showError(id);
        return;
      }
      await focusCursor(dataDir(id), false);
      await execFileAsync('osascript', ['-e', 'delay 0.2', '-e', script]);
      await client.showSuccess(id);
      return;
    }
    if (action === 'profiles') {
      await openSelected(id);
    }
  } catch (error) {
    console.error(`[cursor] ${action} ${error?.code || 'failed'}`);
    await client.showError(id).catch(() => {});
  }
}));

client.on('action.dialRotate', (event) => enqueue(async () => {
  const id = bindingId(event);
  if (actionId(event) !== 'profiles') return;
  const step = rotateStep(event.payload);
  if (!step) return;
  const choices = await profileChoices();
  if (!choices.length) {
    await paint(id, 'profiles', 'Profile');
    return;
  }
  const current = profileIndex.get(id) || 0;
  profileIndex.set(id, (current + step + choices.length * 8) % choices.length);
  await paintKnob(id);
}));

client.on('action.dialDown', (event) => enqueue(async () => {
  const id = bindingId(event);
  if (actionId(event) !== 'profiles') return;
  try {
    await openSelected(id);
  } catch (error) {
    console.error(`[cursor] profiles ${error?.code || 'failed'}`);
    await client.showError(id).catch(() => {});
  }
}));

client.on('plugin.stop', () => {
  if (timer) clearInterval(timer);
  timer = null;
  stopRing();
  for (const dir of scopedDirs()) clearAlive(dir).catch(() => {});
});

await client.start();
