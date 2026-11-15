# Threadline

Hackathon prototype. Keep changes small and demonstrate actual behavior.

- Only authenticated GitHub account `ayushozha` may push directly to `main`. Other contributors must use branches and reviewed pull requests; active GitHub rules enforce this.
- Preserve Git hooks, checks, and remote protections. Never force-push.
- Local `git config push.allowDirect true` is scoped to this repository and implements that request.
- Never commit `.env`, recordings, personal health data, keys, or access tokens.
- Keep AI model selection in named environment variables. No source-code model defaults.
- Do not imply a diagnosed condition, inferred hormonal state, validated clinical effect, or completed external action.
- The app starts empty. The user explicitly requested a fictional dementia demo: keep it opt-in, visibly labeled and in separate per-band storage, with no fabricated sensor readings or completed actions. Never mix fictional examples into real captures. Live requests require explicit permission to send data to providers.
- User data (thread, preferences, schedule, transcripts) is stored in the browser's localStorage per band number. Do not add shared server storage without user isolation.
- Vexo band access uses the official Vexo Open kit (vendored unchanged in app/static/vendor/vexo-open). Pair only the user's own band number.
- For live video, Vexo synchronization, remote viewing, and bring-your-own GoPro/Meta/phone/Pi setup, follow `docs/LIVE_CAPTURE_HANDOFF.md`. It distinguishes current code from required integrations; do not claim a local preview proves remote streaming or AI video analysis.
- Validate with `uv run pytest` and `uv run python -m compileall -q app`; deploy with `./deploy/deploy.ps1`.
- Before edits and before deployment, fetch `origin/main`. Integrate newer commits without losing local or teammate work, inspect the new scope, and rerun relevant checks. Never reset or overwrite uncommitted changes to catch up.
