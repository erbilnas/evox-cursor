import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePluginManifest } from '@evoxapp/plugin-sdk';
import { keyView, LCD_SIZE, rasterImage, renderLcd } from './lcd.mjs';
import {
  ALIVE_MS,
  clampTitle,
  folderTitle,
  profileLabel,
  isDeckAlive,
  isFreshPending,
  skipsDeck,
  matchedDecision,
  pendingLabel,
  permissionOutcome,
  matchingCursorPid,
  acceptVerb,
  profileArgs,
  includedRemaining,
  remainingPercent,
  requestRemainingPercent,
  composerPreference,
  cycleModel,
  hotkeyScript,
  infoPatch,
  modelList,
  rotateStep,
  shortModel,
  nextPhase,
  statusTitle,
  soundChoice,
  userDataDirFromCommand,
  usageLabel,
  parseToken,
} from './cursor.mjs';

const manifest = parsePluginManifest(JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')));
assert.equal(manifest.name, 'Cursor');
assert.equal(manifest.runtime.kind, 'trusted-node');
assert.equal(manifest.runtime.entry, 'runtime.mjs');
assert.deepEqual(manifest.actions.map((action) => action.id), ['status', 'approve', 'deny', 'profile', 'usage', 'stop', 'project', 'model', 'file', 'chat', 'profiles']);
assert.equal(manifest.permissions.length, 1);
assert.equal(manifest.permissions[0].name, 'key.display');

assert.equal(clampTitle('  git   status  '), 'git status');
assert.equal(clampTitle('rm -rf ./very/long/command/path'), 'rm -rf ./very/l...');
assert.equal(clampTitle(''), '');

const now = 10_000;
assert.equal(isDeckAlive({ at: now - ALIVE_MS }, now), true);
assert.equal(isDeckAlive({ at: now - ALIVE_MS - 1 }, now), false);
assert.equal(isDeckAlive(null, now), false);
assert.equal(isFreshPending({ id: 'a', at: now - 1000 }, now), true);
assert.equal(isFreshPending({ id: 'a', at: now - 30_000 }, now), false);

assert.equal(statusTitle({ phase: 'idle' }, null, now), 'Idle');
assert.equal(statusTitle({ phase: 'working' }, null, now), 'Working');
assert.equal(statusTitle({ phase: 'thinking' }, null, now), 'Thinking');
assert.equal(statusTitle({ phase: 'answer' }, null, now), 'Answer');
assert.equal(statusTitle({ phase: 'working' }, { id: 'a', label: 'npm test', at: now }, now), 'npm test');
assert.equal(statusTitle({ phase: 'working' }, { id: 'a', label: '', at: now }, now), 'Needs you');
assert.equal(statusTitle({ phase: 'idle' }, { id: 'a', label: 'old', at: now - 30_000 }, now), 'Idle');
assert.equal(nextPhase('afterAgentThought'), 'thinking');
assert.equal(nextPhase('beforeSubmitPrompt'), 'thinking');
assert.equal(nextPhase('afterShellExecution'), 'thinking');
assert.equal(nextPhase('preToolUse', { tool_name: 'Read' }), 'reading');
assert.equal(nextPhase('preToolUse', { tool_name: 'StrReplace' }), 'editing');
assert.equal(nextPhase('preToolUse', { tool_name: 'AskQuestion' }), 'answer');
assert.equal(nextPhase('afterAgentResponse', { text: 'Want me to continue?' }), 'answer');
assert.equal(nextPhase('afterAgentResponse', { text: 'Done.' }), null);
assert.equal(nextPhase('stop'), 'idle');

assert.equal(matchedDecision({ id: 'a' }, { id: 'a', permission: 'allow' }), 'allow');
assert.equal(matchedDecision({ id: 'a' }, { id: 'b', permission: 'deny' }), null);
assert.equal(matchedDecision({ id: 'a' }, { id: 'a', permission: 'ask' }), null);
assert.deepEqual(permissionOutcome({ deckAlive: false, decision: 'allow', timedOut: false }), { permission: 'ask' });
assert.deepEqual(permissionOutcome({ deckAlive: true, decision: 'allow', timedOut: false }), { permission: 'allow' });
assert.equal(permissionOutcome({ deckAlive: true, decision: null, timedOut: true }).permission, 'ask');
assert.equal(permissionOutcome({ deckAlive: true, decision: 'deny', timedOut: false }).permission, 'deny');
assert.equal(acceptVerb({ hook_event_name: 'beforeShellExecution' }), 'Run');
assert.equal(acceptVerb({ hook_event_name: 'beforeMCPExecution' }), 'Allow');
assert.equal(acceptVerb({ hook_event_name: 'preToolUse', tool_name: 'Write' }), 'Approve');
assert.equal(skipsDeck({ hook_event_name: 'preToolUse', tool_name: 'Shell' }), true);
assert.equal(skipsDeck({ hook_event_name: 'preToolUse', tool_name: 'Write' }), false);

assert.equal(pendingLabel({ command: 'git status' }), 'git status');
assert.equal(pendingLabel({ tool_name: 'search' }), 'search');
assert.equal(pendingLabel({}), 'Needs you');

assert.equal(remainingPercent({ planUsage: { remaining: 16778, limit: 40000 } }), 42);
assert.equal(remainingPercent({ planUsage: { includedSpend: 40000, limit: 40000 } }), 0);
assert.equal(remainingPercent({ planUsage: { totalPercentUsed: 15.48 } }), 85);
assert.equal(remainingPercent({ planUsage: { autoPercentUsed: 21, apiPercentUsed: 0, totalPercentUsed: 90 } }), 11);
assert.equal(remainingPercent({ planUsage: { autoPercentUsed: 0, apiPercentUsed: 0 } }), 0);
assert.equal(remainingPercent({}), null);
assert.equal(requestRemainingPercent({ 'gpt-4': { numRequests: 12, maxRequestUsage: 500 } }), 98);
assert.equal(requestRemainingPercent({ startOfMonth: '2026-09-01', 'gpt-4': { numRequests: 500, maxRequestUsage: 500 } }), 0);
assert.equal(requestRemainingPercent({ startOfMonth: '2026-09-01' }), null);
assert.equal(requestRemainingPercent({ 'gpt-4': { numRequests: 12, maxRequestUsage: null } }), null);
assert.equal(includedRemaining({ billingCycleStart: '1' }, { includedAmountCents: 2000 }), 100);
assert.equal(includedRemaining({ billingCycleStart: '1', planUsage: { limit: 1 } }, { includedAmountCents: 2000 }), null);
assert.equal(usageLabel('signed-out'), 'Sign in');
assert.equal(usageLabel(null), 'Usage ?');
assert.equal(usageLabel(42), '42%');
assert.equal(soundChoice('ring'), 'ring');
assert.equal(soundChoice('off'), 'off');
assert.equal(soundChoice('once'), 'once');
assert.equal(soundChoice(''), 'once');

const home = '/Users/me';
assert.deepEqual(profileArgs('~/Accounts/work', '', home), [
  '--new-window',
  '--user-data-dir',
  '/Users/me/Accounts/work',
]);
assert.deepEqual(profileArgs('/data/work', '~/Projects/app', home), [
  '--new-window',
  '--user-data-dir',
  '/data/work',
  '/Users/me/Projects/app',
]);
assert.equal(profileArgs('relative', '', home), null);
assert.equal(profileArgs('/data/work', 'relative', home), null);
assert.equal(folderTitle('/data/work', home), 'work');
assert.equal(profileLabel(' Work ', '/data/work', home), 'Work');
assert.equal(profileLabel('', '/data/work', home), 'work');
assert.equal(parseToken('"abc"'), 'abc');
assert.equal(parseToken(''), '');

assert.equal(userDataDirFromCommand('/Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir /tmp/work'), '/tmp/work');
assert.equal(userDataDirFromCommand('--user-data-dir="/tmp/my acct"'), '/tmp/my acct');
assert.equal(userDataDirFromCommand('/Applications/Cursor.app/Contents/MacOS/Cursor'), '');
const processes = [
  '11 /Applications/Cursor.app/Contents/MacOS/Cursor',
  '22 /Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir /tmp/work',
].join('\n');
assert.equal(matchingCursorPid(processes, '/tmp/work', home), '22');
assert.equal(matchingCursorPid(processes, '', home), '11');
assert.equal(matchingCursorPid(processes, '/tmp/other', home), '');

assert.equal(infoPatch('sessionStart', { workspace_roots: ['/tmp/apps'], model: 'claude-4.5-sonnet' }).project, 'apps');
assert.equal(infoPatch('afterFileEdit', { file_path: '/tmp/apps/lcd.mjs' }).fileName, 'lcd.mjs');
assert.deepEqual(infoPatch('stop', {}), {});
assert.equal(shortModel('claude-sonnet-4'), 'sonnet');
assert.equal(shortModel(''), 'model');
assert.equal(cycleModel(['composer-1', 'gpt-5'], 'composer-1'), 'gpt-5');
assert.equal(cycleModel(['composer-1'], ''), 'composer-1');
assert.equal(cycleModel([], 'gpt-5'), '');
assert.equal(modelList('composer-1, bad slug, gpt-5').join(','), 'composer-1,gpt-5');
assert.match(composerPreference('{"composer":"composer-1"}', 'gpt-5'), /"composer":"gpt-5"/);
assert.match(hotkeyScript('cmd+n'), /keystroke "n"/);
assert.match(hotkeyScript('cmd+n'), /command down/);
assert.equal(hotkeyScript('cmd+enter'), '');
assert.equal(rotateStep({ direction: 'LEFT' }), -1);
assert.equal(rotateStep({ delta: 3 }), 1);

assert.deepEqual(keyView('status', 'Idle'), { kind: 'idle', label: 'IDLE' });
assert.deepEqual(keyView('status', 'Thinking'), { kind: 'thinking', label: 'THINKING' });
assert.deepEqual(keyView('status', 'Answer'), { kind: 'answer', label: 'ANSWER?' });
assert.deepEqual(keyView('status', 'Needs you'), { kind: 'needs', label: 'WAIT' });
assert.deepEqual(keyView('usage', '42%'), { kind: 'usage', label: '42%' });
assert.notDeepEqual(renderLcd(keyView('usage', '11%')), renderLcd(keyView('usage', '80%')));
assert.deepEqual(keyView('approve', 'Allow'), { kind: 'allow', label: 'ALLOW' });
assert.deepEqual(keyView('approve', 'Run'), { kind: 'allow', label: 'RUN' });
assert.deepEqual(keyView('approve', 'Approve'), { kind: 'allow', label: 'APPROVE' });
const idle = renderLcd(keyView('status', 'Idle'));
const working = renderLcd(keyView('status', 'Working'));
assert.equal(idle[0], 137);
assert.equal(idle.subarray(12, 16).toString('ascii'), 'IHDR');
assert.equal(idle.readUInt32BE(16), LCD_SIZE);
assert.ok(idle.length < 128 * 1024);
assert.notDeepEqual(idle, working);
const image = rasterImage(keyView('stop', 'Stop'));
assert.equal(image.kind, 'raster');
assert.equal(image.mimeType, 'image/png');

console.log('ok');
