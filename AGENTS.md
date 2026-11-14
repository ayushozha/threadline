# Threadline

Hackathon prototype. Keep changes small and demonstrate actual behavior.

- Work directly on `main`; the owner explicitly requested no pull requests for this repository.
- Preserve Git hooks, checks, and remote protections. Never force-push.
- Local `git config push.allowDirect true` is scoped to this repository and implements that request.
- Never commit `.env`, recordings, personal health data, keys, or access tokens.
- Keep AI model selection in named environment variables. No source-code model defaults.
- Do not imply a diagnosed condition, inferred hormonal state, validated clinical effect, or completed external action.
- Synthetic examples must be labeled. Live requests require explicit permission to send data to providers.
- Prototype stores notes only in browser memory. Do not add shared server storage without user isolation.
- Vexo BLE integration awaits the actual Bluetooth contract; do not guess the packet format.
- Validate with `uv run pytest` and `uv run python -m compileall -q app`; deploy with `./deploy/deploy.ps1`.
