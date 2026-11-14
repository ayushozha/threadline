# Threadline

Hackathon prototype. Keep changes small and demonstrate actual behavior.

- Work directly on `main`; the owner explicitly requested no pull requests for this repository.
- Preserve Git hooks, checks, and remote protections. Never force-push.
- Local `git config push.allowDirect true` is scoped to this repository and implements that request.
- Never commit `.env`, recordings, personal health data, keys, or access tokens.
- Keep AI model selection in named environment variables. No source-code model defaults.
- Do not imply a diagnosed condition, inferred hormonal state, validated clinical effect, or completed external action.
- No mock, sample, scripted or fictional data in the app: it starts empty and shows only what the user captured, typed or saved. Live requests require explicit permission to send data to providers.
- User data (thread, preferences, schedule, transcripts) is stored in the browser's localStorage per band number. Do not add shared server storage without user isolation.
- Vexo band access uses the official Vexo Open kit (vendored unchanged in app/static/vendor/vexo-open). Pair only the user's own band number.
- For live video, Vexo synchronization, remote viewing, and bring-your-own GoPro/Meta/phone/Pi setup, follow `docs/LIVE_CAPTURE_HANDOFF.md`. It distinguishes current code from required integrations; do not claim a local preview proves remote streaming or AI video analysis.
- Validate with `uv run pytest` and `uv run python -m compileall -q app`; deploy with `./deploy/deploy.ps1`.
