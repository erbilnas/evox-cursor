import {
  clearIfId,
  detectUserDataDir,
  isDeckAlive,
  clearCarry,
  isFreshCarry,
  isFreshPending,
  isPermissionEvent,
  matchedDecision,
  newPending,
  nextPhase,
  patchInfo,
  permissionOutcome,
  readAlive,
  readCarry,
  readDecision,
  readPending,
  readStatus,
  infoPatch,
  WAIT_MS,
  isQuestion,
  skipsDeck,
  toolPhase,
  writeCarry,
  writePending,
  writeStatus,
} from './cursor.mjs';

const POLL_MS = 200;

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function decide(input, dir) {
  await patchInfo(dir, infoPatch('', input));
  const eventName = String(input?.hook_event_name || '');
  if (isQuestion(input)) {
    await writeStatus(dir, 'answer');
    return { permission: 'ask' };
  }
  if (skipsDeck(input)) {
    const step = toolPhase(eventName, input);
    if (step) await writeStatus(dir, step);
    return { permission: 'allow' };
  }
  if (eventName === 'beforeMCPExecution' && isFreshCarry(await readCarry(dir))) {
    await clearCarry(dir);
    return { permission: 'allow' };
  }
  const alive = await readAlive(dir);
  if (!isDeckAlive(alive)) return permissionOutcome({ deckAlive: false, decision: null, timedOut: false });
  const pending = newPending(input);
  await writePending(dir, pending);
  await writeStatus(dir, 'needs-you');
  const deadline = Date.now() + WAIT_MS;
  let decision = null;
  while (Date.now() < deadline) {
    decision = matchedDecision(pending, await readDecision(dir));
    if (decision) break;
    await sleep(POLL_MS);
  }
  await clearIfId(dir, 'pending.json', pending.id);
  await clearIfId(dir, 'decision.json', pending.id);
  const still = await readPending(dir);
  if (!still?.id) await writeStatus(dir, outcomePermissionPhase(eventName, input, decision));
  const outcome = permissionOutcome({ deckAlive: true, decision, timedOut: !decision });
  if (outcome.permission === 'allow' && eventName === 'preToolUse') await writeCarry(dir);
  return outcome;
}

function outcomePermissionPhase(eventName, input, decision) {
  if (decision !== 'allow') return 'thinking';
  return toolPhase(eventName, input) || 'thinking';
}

async function note(eventName, dir, input) {
  await patchInfo(dir, infoPatch(eventName, input));
  const phase = nextPhase(eventName, input);
  if (!phase) return;
  if (phase === 'idle' && eventName === 'stop') {
    const current = await readStatus(dir);
    if (current?.phase === 'answer') return;
  }
  if (phase !== 'idle' && isFreshPending(await readPending(dir))) return;
  await writeStatus(dir, phase);
}

try {
  const input = await readStdin();
  const eventName = input.hook_event_name || '';
  const dir = await detectUserDataDir().catch(() => undefined);
  if (isPermissionEvent(eventName)) {
    emit(await decide(input, dir).catch(() => ({ permission: 'ask' })));
  } else {
    await note(eventName, dir, input);
    emit(eventName === 'beforeSubmitPrompt' ? { continue: true } : {});
  }
} catch {
  emit({ permission: 'ask' });
}
