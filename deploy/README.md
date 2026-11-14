# Deploy Threadline

The app runs as an unprivileged Python container behind the VPS's existing
Traefik proxy. It uses internal port 3000 on the `coolify` network; it does not
publish a host port or change the shared proxy.

Before deploying:

- Add the DNS A record `threadline.ayushojha.com` pointing to `31.220.52.6`.
- Provision `/home/ayush/threadline/secrets/runtime.env` separately, readable
  only by its owner. The deploy helper never uploads local `.env` files.
- Export the project's locked dependencies into `requirements.txt` and commit
  the application, Dockerfile, and deployment files on `main`.
- Keep `.deploy/` ignored; it contains local commit archives.

From PowerShell in the repository:

```powershell
./deploy/deploy.ps1
Invoke-RestMethod https://threadline.ayushojha.com/api/health
```

The helper requires the `ayushozha/threadline` origin, a clean working tree, and
the existing `ayush-vps` SSH alias. It archives only the committed revision,
builds a commit-tagged image remotely, and checks an isolated candidate before
activation. Existing releases are retained. A failed activation attempts to
restore the previously running image. TLS is issued by the existing proxy once
DNS resolves to this VPS.

Read-only diagnostics:

```powershell
ssh ayush-vps 'docker ps --filter name=threadline-web'
ssh ayush-vps 'docker logs --tail 80 threadline-web'
```

This is a prototype deployment. External HTTPS verification is still required
after the container health check passes.
