# Threadline: Claude handoff from Ayush's Mac

Verified on November 14, 2026. This handoff contains connection metadata, not
private keys or provider credentials. Never paste those credentials into chat.

## Access is already configured

The existing Mac at `Ayushs-MacBook-Pro.local` was reached through the configured
Windows `macbook` SSH connection. Its existing dedicated public key was added
to the VPS, and a nested **Mac → VPS** connection succeeded as `ayush` with
strict host verification and agent forwarding disabled. No private key was
copied between machines.

| Setting | Value |
| --- | --- |
| SSH alias on this Mac | `ayush-vps` |
| Server | `31.220.52.6` / `srv1165436.hstgr.cloud` |
| Port / user | `22` / `ayush` |
| Private key already on this Mac | `~/.ssh/my_vps_mac` |
| Authentication | Existing SSH key; no password needed for the verified connection |
| ED25519 server fingerprint | `SHA256:5cijWGBfW9dqTBrzONpBxsyc8A9SfDzy14BOk4+OrkA` |
| Repository | `https://github.com/ayushozha/threadline.git` |
| Website | `https://threadline.ayushojha.com` |
| App root on VPS | `/home/ayush/threadline` |
| Running container / Compose project | `threadline-web` / `threadline` |
| Private backend environment | `/home/ayush/threadline/secrets/runtime.env` |
| Current deployment record | `/home/ayush/threadline/current-revision` |
| Immutable release directories | `/home/ayush/threadline/releases/<commit-sha>` |
| Uploaded Git archives | `/home/ayush/threadline/uploads/<commit-sha>.tar.gz` |
| Deployment lock | `/home/ayush/threadline/deploy.lock` |
| Shared Docker network | `coolify` — preserve other applications |

Run this in the Mac terminal or Claude Code:

```bash
ssh -o BatchMode=yes -o ForwardAgent=no ayush-vps \
  'id -un; hostname; cat /home/ayush/threadline/current-revision; docker inspect --format "{{.State.Health.Status}}" threadline-web'
curl --fail --silent --show-error https://threadline.ayushojha.com/api/health
```

Expected user: `ayush`; expected container health: `healthy`. The revision can
change while other work lands, so read it rather than assuming this file's
audit revision is the deployed one.

For interactive access:

```bash
ssh ayush-vps
```

If the alias is unavailable in another terminal environment, the direct command
on this same Mac is:

```bash
ssh -i ~/.ssh/my_vps_mac -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o ForwardAgent=no ayush@31.220.52.6
```

Never disable host checking. If the host key changes, verify the server before
updating `known_hosts`. A different Mac needs its own authorized public key;
these instructions do not imply that the private key exists on another machine.

## Copy this task to Claude

```text
Work on Threadline at https://github.com/ayushozha/threadline.
Read AGENTS.md and docs/CLAUDE_MAC_HANDOFF.md first.

I have authorized access from this Mac. SSH alias ayush-vps already works with
~/.ssh/my_vps_mac, user ayush, server 31.220.52.6, port 22. Use strict host
verification and ForwardAgent=no. Do not ask for a server password or copy a
private key. First verify `ssh -o BatchMode=yes ayush-vps 'id -un'` returns ayush.

Only touch Threadline under /home/ayush/threadline and container threadline-web.
Other apps share this VPS. Provider credentials are already in the private
/home/ayush/threadline/secrets/runtime.env. Do not print, paste, commit or copy
that file to the Mac. VPS access is enough for server-side checks. Keep models
environment-driven. Local development can use mocks or a deliberate private
environment setup; do not silently harvest production credentials.

Inspect the existing local checkout before cloning another. Fetch origin/main,
preserve any dirty work, and compare the remote deployment revision. The VPS
has immutable releases, not a normal Git working tree: do not run git pull in
a release directory or edit the live release in place.

Only GitHub account ayushozha may push directly to main; others must use PRs.
Verify `gh api user --jq .login` before GitHub mutations. Keep branch rules,
hooks and no-force-push protections. There is a background watcher that checks
main about every 15 minutes; avoid concurrent edits/deployments and honor the
/home/ayush/threadline/deploy.lock lock.

Deployment's canonical implementation is deploy/deploy.ps1. It archives a
clean main, uploads the exact Git SHA, builds a commit-tagged image, smoke-tests
a candidate, then activates only the Threadline Compose project with rollback.
The Mac's noninteractive SSH PATH had git/python3 but not pwsh, uv or node at
verification. Check the interactive shell before declaring tools unavailable.
Do not replace shared proxy/Compose configuration just to deploy. Reuse the
canonical helper where PowerShell is available, or port its exact safety and
rollback checks to a reviewed Mac entry point. Verify HTTPS and the remote SHA
after deployment, not just a successful build.

The app already has Vexo 73 audio → Deepgram transcription → Gemini decisions,
automatic notes in Just me mode, summaries, energy self-reports, task drafts,
and a graph. The audit below identifies remaining work; these are gaps, not
features already implemented. Do not call preview video remote streaming or
call a task draft an executed external action.

First fix grounded task decisions and wearer-local due dates, then finish one
visual interrupted-task demo: camera evidence + Vexo question + source-linked
next step + actual spoken reply on host/headphones. Do not infer medication
ingestion, hormones, diagnosis, or safety from a frame or from tone. Keep
ambiguous progress unknown and confirm consequential actions.
```

## Audit: what is still missing

Audit source: `6388bc8`; public server was still `c600cae` when checked. Re-fetch
before work because concurrent commits and the deployment watcher can advance
both. This was a source audit plus focused reproductions, not clinical testing.
While this handoff was being written, `59efa8b` added profile labels, browser-local
remembered watch pairing, and HTTP session renewal. Those changes do not add
cross-device history or visual reasoning; they were inspected as a diff here,
not fully runtime-validated. The initial SSH/deployment facts above remain valid.

| Priority | Finding | Evidence / next step |
| --- | --- | --- |
| P1 | Task advice bypasses the newer self-report guard | Reproduced `hold_decision` for “I am not tired”, “My friend is exhausted”, and past exhaustion with `energy_signal=null`. `app/agent.py`: `local_task_proposal`, `finalize`. Require grounded current self-report for energy-driven actions, including model proposals. |
| P1 | No visual reasoning or spoken assistance | `startVideo` in `app/static/app.js` only records in the browser; `/api/reflect` accepts text notes. No visual inference endpoint, in-app ElevenLabs response, remote viewer, Meta bridge, or Pi bridge. Choose one camera-to-evidence-to-answer flow; do not expand every hardware path at once. |
| P1 | Personal state does not follow the user to the Mac | Notes, tasks, energy, and raw transcripts use browser-local storage by band number. Same website and same band on another browser do not restore them. Add explicit export/import first if needed; durable sync requires real user isolation. |
| P2 | Reminder means task draft, not a scheduled notification | No task-deadline delivery scheduler. Relative dates only parse trailing English today/tomorrow; use of server `date.today()` was reproduced as one-day-wrong near UTC rollover. Resolve against wearer-local date/timezone, expose the due date for review, then implement delivery. |
| P2 | Overdue decisions are classified as due soon | `task_eligible` checks `days <= 3` without a lower bound, so even a decision overdue 60 days qualifies. Define and test the intended overdue behavior. |
| P2 | Previous band's graph can remain visible after switching | `loadThread` clears summaries and the action feed but not graph data, SVG, or selected source details immediately. Reset those derived views and cancel/invalidate pending work. |
| P2 | Shared self-report can be saved twice | The confirmation card saves a note without marking its raw `lineIds` saved; Stop review may add the same statement again. Reuse the existing line-ID deduplication path. |
| P2 | Retention wording contradicts behavior | `index.html` says other speakers are “dropped, not stored”, but `archiveSession` stores the full raw transcript. State clearly that exclusion from the personal Thread does not delete the raw transcript. |
| P2 | Apple Watch is not at Vexo feature parity | Watch audio appends directly to Live, bypassing the automatic utterance/agent path. Sensor frames refresh Energy/Daily log but not Your day, and stale readings remain after disconnect. Reuse the same transcript path and show freshness. |
| P2 | Profile labels overstate isolation/sharing | The newly added own-device text says readings reach only the paired browser and a default profile shows the owner's shared data. Existing state is browser-local, and a claimed watch feed is guarded by a guest cookie plus pairing code, not a recorded browser owner. Verify those guarantees before presenting either claim. |
| Product | PMS personalization is a concept, not a learned pattern engine | Current code averages cycle start intervals and stores self-reports; no cross-cycle comparison, “was this cycle-related?” feedback, or record of which support helped. No validated hormone or symptom prediction. |
| Product | External actions are limited | Calendar is an internal schedule plus .ics/Google Calendar template links. Messages use the share sheet. No purchase execution, delivery verification, care-circle backend or real calendar connector. |
| Demo | Old instructions/narration do not describe the latest UI | `docs/DEMO.md` still describes manual saves and switching the graph to Gemini. The edited pitch assets are not evidence of live voice output. Re-record the actual current flow after the visual slice works. |

### Verified foundation and limits

- Live Vexo/Deepgram flow, reconnect, automatic note ingestion and Gemini
  decisions were previously exercised with recorded public-domain audio over
  simulated band transport. First text in that run was about 1.2 seconds; this
  is not a latency guarantee for physical hardware or every language.
- English, Nepali and Spanish text self-reports returned real Gemini decisions.
  This does not establish acoustic multilingual accuracy.
- The current watch visitor change passed 11 targeted pairing tests in this
  audit. Native watchOS build and physical GoPro/Meta/Pi integration were not
  verified here.
- The app is a bounded public demo: browser sessions expire after two hours,
  with request, byte and stream limits. It is not an all-day unattended recorder.
- Vexo's current kit has no speaker. Spoken output must play on the host device
  or headphones. An SD card or a GoPro by itself supplies no cloud integration.
