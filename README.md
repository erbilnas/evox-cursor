# Cursor for evoX

[English](README.md) · [Türkçe](README.tr.md)

Agent status, allow/deny, isolated profiles, and remaining usage on an [evoX](https://evoxapp.com) deck.

This is a **trusted-node** plugin: it runs as its own Node process with full local access. Only load source you trust.

LCD cells are keypad keys. Each one shows an icon and a short label such as `Idle`, `Working`, a command, a profile name, or remaining-usage percent.

## Requirements

- [evoX](https://evoxapp.com) **0.2.0** or newer
- [Node.js](https://nodejs.org/) 18+ (for `npm install` / `npm run check`)
- [Cursor](https://cursor.com) with hooks enabled
- `sqlite3` CLI on your `PATH` (used only to read that profile’s local Cursor state for usage)
- macOS for Stop / New chat focus via Accessibility (same permission evoX uses for hotkeys)

## Install

```bash
git clone https://github.com/<you>/evox-cursor.git
cd evox-cursor
npm install
npm run check
```

### 1. Load the plugin in evoX Developer

1. Open **evoX**.
2. Go to **Plugins → Developer**.
3. Select / add this project folder (the folder that contains `manifest.json`).
4. Read the trust prompt and **start** the plugin.
5. After code changes, use **Reload** in the Developer window.

### 2. Wire Cursor hooks

Cursor must call `cursor-hook.mjs` from this folder. Copy [`hooks.example.json`](hooks.example.json) into `~/.cursor/hooks.json` (or merge into an existing file), then replace every `/ABSOLUTE/PATH/TO/evox-cursor` with the real absolute path of this clone.

Example command line:

```text
node "/Users/you/code/evox-cursor/cursor-hook.mjs"
```

Restart Cursor (or reload hooks) after editing `hooks.json`.

Shell, MCP, and other tool calls wait on the deck for about **20 seconds** while evoX has the plugin open. The Allow key label becomes **Run**, **Approve**, or **Allow** to match the prompt. Deny blocks it. No press, or evoX not running, returns `ask`, so Cursor’s own approval card still appears. File reads and searches do not wait. One prompt at a time: a second prompt replaces the label on the keys.

### 3. Assign keys on the deck

1. Open **Keys** in evoX.
2. Drag **Status**, **Allow**, **Deny**, **Stop**, **Usage**, **Project**, **Model**, **Last file**, **New chat**, and **Profile** onto keypad keys.
3. Put **Profiles** on a knob / dial.
4. On each **Profile** key, set:
   - **User data directory** — absolute folder Cursor should use as `--user-data-dir` (a separate account)
   - **Name** — optional label (defaults to the folder name)
   - **Workspace** — optional project folder to open
5. On Status, Allow, Deny, Stop, Usage, Project, Model, Last file, and New chat, leave the path blank for this machine’s default Cursor account, or set another user-data directory.

Optional: set `CURSOR_BIN` if the `cursor` CLI is not on your `PATH` (macOS default fallback is `/usr/local/bin/cursor`).

## What the keys do

| Action | Control | Result |
| --- | --- | --- |
| Status | LCD key | `Idle`, `Thinking`, `Reading`, `Editing`, `Running`, `Answer`, or the waiting command. Press focuses that Cursor window. |
| Allow / Deny | LCD key | Allow shows Run / Allow / Approve for the waiting prompt. Deny blocks it. |
| Profile | LCD key | Opens `cursor --new-window --user-data-dir "<path>"` (+ workspace when set). |
| Usage | LCD key | Remaining included-plan percent for that account. `Sign in` if unsigned. Press refreshes. |
| Stop | LCD key | Focuses that window and sends Escape (macOS + Accessibility). |
| Project | LCD key | Folder from the last hook. Press focuses the window. |
| Model | LCD key | Model from the last hook. Press cycles the comma-separated list and writes `cursor/lastSingleModelPreference`. |
| Last file | LCD key | Last file an agent edit touched. Press opens it with `cursor --reuse-window`. |
| New chat | LCD key | Focuses the window, then sends the shortcut (`cmd+n` when blank). |
| Profiles | Knob | Rotate through Profile keys on the deck. Press launches the selected one. |

A waiting prompt can play a sound. On the Status key, set **Waiting sound** to Off, Once, or Ring. Ring repeats until the prompt is answered or it times out. Approvals still fail open to Cursor’s own card if the plugin is not heartbeating or after about 20 seconds.

## Usage limit

Usage reads `cursorAuth/accessToken` from that profile’s local `state.vscdb` and calls Cursor’s usage endpoints. The token stays on this machine: it is **not** written into the repo, deck settings, logs, or bridge JSON under the profile’s `evox-deck` folder. Those endpoints are not a public API; if they change, the key shows `Usage ?`.

`npm run check` covers percent math, title clamp, stale heartbeat, and decision matching.

## Security notes (before you publish or share)

- **Trusted-node**: anyone who can edit this folder can run arbitrary Node code when the plugin is started. Only install from a repo you trust; review diffs before Reload.
- **No secrets in git**: this repo must never contain Cursor session tokens, profile exports, or personal absolute paths with credentials.
- **Local bridge files** under `{userDataDir}/evox-deck/` are written mode `0600`. Do not commit them.
- **Hooks**: `~/.cursor/hooks.json` runs local commands. Keep the path pointed at *your* clone, not a world-writable directory.
- Do not commit `.env`, evoX settings exports, or `.cursor/` IDE state.

## Market / packaging

`evox-plugin validate`, `build`, and `pack` apply to sandbox plugins, not this trusted-node project. Install from **Plugins → Developer** until public upload is available.
