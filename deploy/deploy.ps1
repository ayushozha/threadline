[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Assert-NativeSuccess([string]$Action) {
    if ($LASTEXITCODE -ne 0) { throw "$Action failed (exit $LASTEXITCODE)." }
}

Push-Location $repoRoot
try {
    $gitRoot = git rev-parse --show-toplevel
    Assert-NativeSuccess 'Repository check'
    if ([IO.Path]::GetFullPath($gitRoot) -ne $repoRoot) { throw 'Run from the Threadline repository.' }
    $branch = git branch --show-current
    Assert-NativeSuccess 'Branch check'
    if ($branch -ne 'main') { throw 'This deployment helper deploys main only.' }
    $origin = git remote get-url origin
    Assert-NativeSuccess 'Origin check'
    if ($origin -notmatch '^(https://github\.com/ayushozha/|git@github\.com:ayushozha/)threadline(\.git)?$') {
        throw 'Unexpected origin; expected ayushozha/threadline.'
    }
    $dirty = git status --porcelain
    Assert-NativeSuccess 'Working tree check'
    if ($dirty) { throw 'Commit the task-owned changes before deploying HEAD.' }
    $tracked = git ls-files
    Assert-NativeSuccess 'Tracked file check'
    if ($tracked | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '(^|/)\.env\.example$' }) {
        throw 'A runtime environment file is tracked. Remove it from the repository before deployment.'
    }
    $revision = git rev-parse HEAD
    Assert-NativeSuccess 'Revision check'
    if ($revision -notmatch '^[0-9a-f]{40}$') { throw 'Invalid commit revision.' }

    $stage = Join-Path $repoRoot '.deploy'
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    $archive = Join-Path $stage "$revision.tar.gz"
    git archive --format=tar.gz "--output=$archive" HEAD
    Assert-NativeSuccess 'Archive creation'

    ssh -o BatchMode=yes -o ForwardAgent=no ayush-vps 'set -eu; test "$(id -un)" = ayush; mkdir -p /home/ayush/threadline/uploads; chmod 700 /home/ayush/threadline /home/ayush/threadline/uploads'
    Assert-NativeSuccess 'Remote directory preparation'
    scp -o BatchMode=yes -o ForwardAgent=no $archive "ayush-vps:/home/ayush/threadline/uploads/$revision.tar.gz"
    Assert-NativeSuccess 'Archive upload'

    $remoteScript = @'
set -Eeuo pipefail
umask 077
root=/home/ayush/threadline
revision=__REVISION__
release="$root/releases/$revision"
image="threadline:$revision"
candidate="threadline-check-${revision:0:12}"
test "$(id -un)" = ayush
test -f "$root/secrets/runtime.env"
docker network inspect coolify >/dev/null
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another Threadline deployment is running.' >&2; exit 1; }
mkdir -p "$release"
tar -xzf "$root/uploads/$revision.tar.gz" -C "$release" --no-same-owner
test -f "$release/Dockerfile"
test -f "$release/deploy/compose.yaml"
docker build --label "org.opencontainers.image.revision=$revision" --tag "$image" "$release"

# Never alter another project's container, including on a name collision.
if docker inspect threadline-web >/dev/null 2>&1; then
  test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' threadline-web)" = threadline
fi
if docker inspect "$candidate" >/dev/null 2>&1; then
  echo "Candidate $candidate already exists; inspect it before retrying." >&2
  exit 1
fi
docker run --detach --name "$candidate" --network coolify \
  --env-file "$root/secrets/runtime.env" --init --cap-drop ALL \
  --security-opt no-new-privileges:true "$image" >/dev/null
cleanup() { docker rm -f "$candidate" >/dev/null 2>&1 || true; }
trap cleanup EXIT
healthy=false
for attempt in {1..30}; do
  if docker exec "$candidate" python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3000/api/health', timeout=4)" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  echo 'Candidate failed health check; live deployment unchanged.' >&2
  exit 1
fi
cleanup
trap - EXIT

previous_image=$(docker inspect --format '{{.Config.Image}}' threadline-web 2>/dev/null || true)
if ! THREADLINE_IMAGE="$image" docker compose --project-name threadline \
  --file "$release/deploy/compose.yaml" up --detach --no-build --pull never --wait --wait-timeout 120; then
  if [[ -n "$previous_image" ]]; then
    THREADLINE_IMAGE="$previous_image" docker compose --project-name threadline \
      --file "$release/deploy/compose.yaml" up --detach --no-build --pull never --wait --wait-timeout 120
  fi
  echo 'Activation failed; deployment was not recorded as successful.' >&2
  exit 1
fi
printf '%s\n' "$revision" > "$root/current-revision"
echo "Deployed $revision. Verify https://threadline.ayushojha.com/api/health after DNS resolves."
'@
    $remoteScript = $remoteScript.Replace('__REVISION__', $revision).Replace("`r`n", "`n")
    $remoteScript | ssh -o BatchMode=yes -o ForwardAgent=no ayush-vps 'bash -s'
    Assert-NativeSuccess 'Remote deployment'
}
finally {
    Pop-Location
}
