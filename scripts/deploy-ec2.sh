#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_ROOT="$HOME/casa/casa-api"
RELEASE_ID="${1:-}"
ARCHIVE_PATH="${2:-}"

if [[ ! "$RELEASE_ID" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]]; then
  echo 'Expected a commit SHA, workflow run ID, and attempt as the release ID.' >&2
  exit 2
fi
if [[ "$ARCHIVE_PATH" != "$DEPLOY_ROOT/uploads/$RELEASE_ID.tar.gz" || ! -f "$ARCHIVE_PATH" ]]; then
  echo 'Release archive is missing or has an unexpected path.' >&2
  exit 2
fi
if ! command -v npm >/dev/null || ! command -v flock >/dev/null; then
  echo 'Install npm and flock on EC2 before enabling auto deploy.' >&2
  exit 2
fi
NODE_BIN="$(command -v node-24 || command -v node || true)"
if [[ -z "$NODE_BIN" || "$("$NODE_BIN" -p 'process.versions.node.split(`.`)[0]')" != '24' ]]; then
  echo 'EC2 must run Node.js 24.' >&2
  exit 2
fi
sudo -n true || {
  echo 'EC2_USER needs non-interactive sudo for systemd service management.' >&2
  exit 2
}

mkdir -p "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/shared"
NODE_SHIM_DIR="$DEPLOY_ROOT/shared/node24-bin"
mkdir -p "$NODE_SHIM_DIR"
ln -sfn "$NODE_BIN" "$NODE_SHIM_DIR/node"
export PATH="$NODE_SHIM_DIR:$PATH"
exec 9>"$DEPLOY_ROOT/deploy.lock"
flock -n 9 || {
  echo 'Another backend deployment is already running.' >&2
  exit 1
}

if [[ ! -f "$DEPLOY_ROOT/shared/runtime.env" ]]; then
  cat >"$DEPLOY_ROOT/shared/runtime.env" <<'ENVIRONMENT'
NODE_ENV=production
PORT=3001
AWS_REGION=us-east-1
S3_BUCKET_NAME=casa-s3-prod-066640849393-us-east-1-an
API_PREFIX=v1
WEB_ORIGIN=https://somoscasa.site
TRUSTED_PROXY_CIDRS=
ENVIRONMENT
  chmod 600 "$DEPLOY_ROOT/shared/runtime.env"
  echo "Created $DEPLOY_ROOT/shared/runtime.env. Set TRUSTED_PROXY_CIDRS to the ALB's trusted network, then rerun the deployment." >&2
  exit 2
fi

set -a
# This owner-controlled file uses systemd EnvironmentFile KEY=VALUE syntax.
source "$DEPLOY_ROOT/shared/runtime.env"
set +a
if [[ -z "${TRUSTED_PROXY_CIDRS:-}" ]]; then
  echo 'Set TRUSTED_PROXY_CIDRS in shared/runtime.env before deploying.' >&2
  exit 2
fi

RELEASE_DIR="$DEPLOY_ROOT/releases/$RELEASE_ID"
if [[ -e "$RELEASE_DIR" ]]; then
  echo "Release $RELEASE_ID already exists; refusing to overwrite it." >&2
  exit 2
fi
mkdir "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
rm -f -- "$ARCHIVE_PATH"
cd "$RELEASE_DIR"

npm ci
npm run prisma:generate
npm run build

UNIT_FILE="$RELEASE_DIR/casa-api.service"
cat >"$UNIT_FILE" <<UNIT
[Unit]
Description=CASA API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$DEPLOY_ROOT/current
EnvironmentFile=$DEPLOY_ROOT/shared/runtime.env
ExecStart=$NODE_BIN $DEPLOY_ROOT/current/dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
UNIT
sudo -n install -m 0644 "$UNIT_FILE" /etc/systemd/system/casa-api.service
sudo -n systemctl daemon-reload

PREVIOUS_RELEASE=''
if [[ -L "$DEPLOY_ROOT/current" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$DEPLOY_ROOT/current")"
fi
NEXT_LINK="$DEPLOY_ROOT/current.next.$RELEASE_ID"
ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$DEPLOY_ROOT/current"

if ! sudo -n systemctl enable casa-api.service >/dev/null || ! sudo -n systemctl restart casa-api.service; then
  echo 'Service restart failed; restoring previous release.' >&2
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    ln -s "$PREVIOUS_RELEASE" "$NEXT_LINK"
    mv -Tf "$NEXT_LINK" "$DEPLOY_ROOT/current"
    sudo -n systemctl restart casa-api.service || true
  else
    sudo -n systemctl stop casa-api.service || true
  fi
  exit 1
fi

HEALTHY=false
for attempt in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:${PORT}/${API_PREFIX}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    HEALTHY=true
    break
  fi
  sleep 2
done

if [[ "$HEALTHY" != true ]]; then
  echo 'New release did not become healthy; restoring previous release.' >&2
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    ln -s "$PREVIOUS_RELEASE" "$NEXT_LINK"
    mv -Tf "$NEXT_LINK" "$DEPLOY_ROOT/current"
    sudo -n systemctl restart casa-api.service || true
  else
    sudo -n systemctl stop casa-api.service || true
  fi
  exit 1
fi

CURRENT_RELEASE="$(readlink -f "$DEPLOY_ROOT/current")"
while IFS= read -r stale_release; do
  [[ -n "$stale_release" ]] || continue
  case "$stale_release" in
    "$DEPLOY_ROOT"/releases/*) ;;
    *) echo 'Skipping an unexpected release cleanup path.' >&2; continue ;;
  esac
  [[ "$stale_release" != "$CURRENT_RELEASE" && ! -L "$stale_release" && -d "$stale_release" ]] || continue
  rm -rf -- "$stale_release"
done < <(find "$DEPLOY_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | awk 'NR > 3 { sub(/^[^ ]+ /, ""); print }')

rm -f -- "$DEPLOY_ROOT/uploads/deploy-$RELEASE_ID.sh"
echo "Deployed CASA API release $RELEASE_ID successfully."
