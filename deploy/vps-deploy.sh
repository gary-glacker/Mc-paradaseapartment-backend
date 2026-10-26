#!/usr/bin/env bash
# ============================================================
#  MC Paradise Apartment — build & restart
#
#  Pulls the latest code, installs dependencies, builds the
#  frontend and reloads the API. Run it after every push:
#
#      sudo -u deploy bash /var/www/mc-paradise/deploy/vps-deploy.sh
#
#  It can also be run as root; it will switch to APP_USER itself.
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DOMAIN="${DOMAIN:-mcparadiseapartment.com}"
APP_DIR="${APP_DIR:-/var/www/mc-paradise}"
APP_USER="${APP_USER:-deploy}"
BRANCH="${BRANCH:-main}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m  ! %s\033[0m\n' "$*" >&2; }
die()  { printf '\n\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ] && [ "$APP_USER" != "root" ]; then
  APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
  [ -n "$APP_HOME" ] || die "Unknown user '$APP_USER'"
  exec runuser -u "$APP_USER" -- env HOME="$APP_HOME" bash "$0" "$@"
fi

[ -d "$APP_DIR/.git" ] || die "No backend checkout at $APP_DIR"
[ -d "$APP_DIR/Frontend/.git" ] || die "No frontend checkout at $APP_DIR/Frontend"

pull() {
  local dir="$1" label="$2"
  log "Updating $label"
  git -C "$dir" fetch --prune origin
  git -C "$dir" checkout "$BRANCH" >/dev/null
  git -C "$dir" pull --ff-only
  ok "$label at $(git -C "$dir" rev-parse --short HEAD)"
}

install_node_deps() {
  local dir="$1" label="$2"
  shift 2
  log "Installing $label dependencies"
  cd "$dir"
  if ! npm ci "$@"; then
    warn "npm ci failed (lockfile out of sync?) — falling back to npm install"
    npm install "$@"
  fi
}

build_frontend() {
  log "Building the frontend"
  cd "$APP_DIR/Frontend"

  cat > .env <<EOF
VITE_API_URL=/api
VITE_APP_NAME=MC Paradise Apartment
VITE_PORTAL_BASE_URL=https://$DOMAIN
EOF

  install_node_deps "$APP_DIR/Frontend" "frontend"
  npm run build
  [ -f dist/index.html ] || die "Frontend build produced no dist/index.html"
  ok "Frontend built to Frontend/dist"
}

start_api() {
  log "Restarting the API with PM2"
  cd "$APP_DIR/backend"
  pm2 startOrReload "$HERE/ecosystem.config.cjs"
  pm2 save >/dev/null
  ok "PM2 process 'mc-paradise-api' is online"
}

reload_nginx() {
  if [ "$(id -u)" -eq 0 ]; then
    nginx -t && systemctl reload nginx
  elif sudo -n nginx -t >/dev/null 2>&1 && sudo -n systemctl reload nginx >/dev/null 2>&1; then
    ok "Nginx reloaded"
  else
    warn "Cannot reload Nginx without sudo — run: sudo systemctl reload nginx"
    return
  fi
  ok "Nginx reloaded"
}

health_check() {
  log "Health check"
  local i body=""
  for i in $(seq 1 20); do
    if body="$(curl -fsS --max-time 3 http://127.0.0.1:4000/api/health 2>/dev/null)"; then
      ok "API responded: $body"
      return
    fi
    sleep 1
  done
  warn "API did not answer on http://127.0.0.1:4000/api/health"
  warn "Check the logs:  pm2 logs mc-paradise-api --lines 50"
}

main() {
  pull "$APP_DIR" "backend"
  install_node_deps "$APP_DIR/backend" "backend" --omit=dev
  pull "$APP_DIR/Frontend" "frontend"
  build_frontend
  start_api
  reload_nginx
  health_check

  printf '\n\033[1;32mDone.\033[0m  %s\n\n' \
    "${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$(hostname -I | awk '{print $1}')}"
}

main "$@"
