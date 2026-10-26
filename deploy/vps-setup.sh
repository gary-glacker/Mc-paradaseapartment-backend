#!/usr/bin/env bash
# ============================================================
#  MC Paradise Apartment — one-time VPS provisioning
#  Ubuntu 22.04 / 24.04 (Scratch Cloud or any provider)
#
#  Usage (as root, from the deploy/ folder):
#      cp deploy.env.example deploy.env && nano deploy.env
#      sudo bash vps-setup.sh
#
#  Installs Node.js 22, PM2, MongoDB 8 (local), Nginx, Certbot,
#  creates the app user, clones both repositories, writes
#  backend/.env with fresh secrets, configures Nginx + UFW,
#  requests a Let's Encrypt certificate, then deploys the app.
#
#  Safe to re-run: every step checks before it acts, and the
#  backend .env is never overwritten once it exists.
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DOMAIN="${DOMAIN:-mcparadiseapartment.com}"
LE_EMAIL="${LE_EMAIL:-admin@mcparadiseapartment.com}"
APP_DIR="${APP_DIR:-/var/www/mc-paradise}"
APP_USER="${APP_USER:-deploy}"
REPO_BACKEND="${REPO_BACKEND:-https://github.com/gary-glacker/Mc-paradaseapartment-backend.git}"
REPO_FRONTEND="${REPO_FRONTEND:-git@github.com:gary-glacker/Mc-paradaseapartment.git}"
BRANCH="${BRANCH:-main}"
MONGO_DB="${MONGO_DB:-mc_paradise}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"
APP_HOME=""

if [ -z "${SSH_PORT:-}" ] && [ -n "${SSH_CONNECTION:-}" ]; then
  SSH_PORT="$(awk '{print $4}' <<<"$SSH_CONNECTION")"
fi
SSH_PORT="${SSH_PORT:-22}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m  ! %s\033[0m\n' "$*" >&2; }
die()  { printf '\n\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "Run this as root:  sudo bash $0"
}

validate() {
  case "$APP_DIR" in
    /?*) ;;
    *) die "APP_DIR must be an absolute path (got '$APP_DIR')" ;;
  esac
  [ -n "$APP_USER" ] || die "APP_USER is empty"
  [ -n "$REPO_BACKEND" ] || die "REPO_BACKEND is empty"
  [ -n "$REPO_FRONTEND" ] || die "REPO_FRONTEND is empty"
  if [ -n "$DOMAIN" ] && [ -z "$LE_EMAIL" ]; then
    warn "LE_EMAIL is empty — HTTPS will be skipped."
  fi
}

install_packages() {
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y \
    curl git gnupg ca-certificates build-essential ufw nginx \
    certbot python3-certbot-nginx rsync unzip openssl

  local major=0
  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]')"
  fi
  if [ "$major" -lt 20 ]; then
    log "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  ok "Node.js $(node -v), npm $(npm -v)"

  if ! command -v pm2 >/dev/null 2>&1; then
    log "Installing PM2"
    npm install -g pm2
  fi
  ok "PM2 $(pm2 -v)"
}

install_mongodb() {
  log "Installing local MongoDB"
  if ! command -v mongod >/dev/null 2>&1; then
    # shellcheck disable=SC1091
    . /etc/os-release
    local codename="${VERSION_CODENAME:-jammy}"
    local series="8.0"
    local keyring="/usr/share/keyrings/mongodb-server-${series}.gpg"

    curl -fsSL "https://pgp.mongodb.com/server-${series}.asc" \
      | gpg --dearmor -o "$keyring"

    write_repo() {
      local codename="$1"
      echo "deb [ arch=$(dpkg --print-architecture) signed-by=${keyring} ] https://repo.mongodb.org/apt/ubuntu ${codename}/mongodb-org/${series} multiverse" \
        > "/etc/apt/sources.list.d/mongodb-org-${series}.list"
      apt-get update -y
    }

    write_repo "$codename"
    if ! apt-get install -y mongodb-org; then
      warn "MongoDB ${series} is not published for '${codename}' — falling back to the jammy repository."
      write_repo jammy
      apt-get install -y mongodb-org
    fi
  fi

  systemctl enable --now mongod

  log "Waiting for MongoDB to accept connections"
  local i
  for i in $(seq 1 30); do
    if mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; then
      ok "MongoDB is up on 127.0.0.1:27017"
      return
    fi
    sleep 2
  done
  die "MongoDB did not start. Check: journalctl -u mongod -n 50 --no-pager"
}

create_user() {
  log "Preparing the app user and SSH access"
  if [ "$APP_USER" = "root" ]; then
    APP_HOME="/root"
  else
    APP_HOME="/home/$APP_USER"
    if ! getent passwd "$APP_USER" >/dev/null; then
      adduser --disabled-password --gecos "" "$APP_USER"
      ok "Created user '$APP_USER'"
    fi

    install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME/.ssh"
    if [ ! -s "$APP_HOME/.ssh/authorized_keys" ] && [ -s /root/.ssh/authorized_keys ]; then
      install -m 600 -o "$APP_USER" -g "$APP_USER" \
        /root/.ssh/authorized_keys "$APP_HOME/.ssh/authorized_keys"
      ok "Copied root's SSH key to '$APP_USER'"
    fi

    # The deploy user needs exactly two root commands, nothing more.
    local nginx_bin systemctl_bin
    nginx_bin="$(command -v nginx)"
    systemctl_bin="$(command -v systemctl)"
    cat > /etc/sudoers.d/mc-paradise-deploy <<EOF
$APP_USER ALL=(root) NOPASSWD: $systemctl_bin reload nginx, $systemctl_bin status nginx, $nginx_bin -t
EOF
    chmod 440 /etc/sudoers.d/mc-paradise-deploy
    visudo -cf /etc/sudoers.d/mc-paradise-deploy >/dev/null
  fi

  # Read-only git deploy key (used when a repository is private).
  if [ ! -f "$APP_HOME/.ssh/id_ed25519" ]; then
    runuser -u "$APP_USER" -- \
      ssh-keygen -t ed25519 -N "" -C "mc-paradise-vps" -f "$APP_HOME/.ssh/id_ed25519" >/dev/null
  fi
  ssh-keyscan -H github.com >> "$APP_HOME/.ssh/known_hosts" 2>/dev/null || true
  sort -u "$APP_HOME/.ssh/known_hosts" -o "$APP_HOME/.ssh/known_hosts" 2>/dev/null || true
  chown -R "$APP_USER:$APP_USER" "$APP_HOME/.ssh" 2>/dev/null || true
  chmod 600 "$APP_HOME/.ssh/known_hosts" 2>/dev/null || true

  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  ok "App directory: $APP_DIR"
}

clone_repos() {
  log "Fetching the code"
  git_as() { runuser -u "$APP_USER" -- git "$@"; }

  checkout() {
    local repo="$1" dest="$2" label="$3"
    if [ -d "$dest/.git" ]; then
      git_as -C "$dest" fetch --prune origin
      git_as -C "$dest" checkout "$BRANCH"
      git_as -C "$dest" pull --ff-only
      ok "$label updated ($BRANCH)"
      return
    fi

    if [ -e "$dest" ]; then
      # A clone of the backend repo leaves an empty `Frontend/` git-link directory.
      if [ -d "$dest" ] && [ -z "$(ls -A "$dest" 2>/dev/null)" ]; then
        rmdir "$dest"
      else
        die "$dest exists but is not a git checkout. Move it away and re-run."
      fi
    fi

    if ! git_as clone --branch "$BRANCH" "$repo" "$dest"; then
      rm -rf "$dest"
      return 1
    fi
    ok "$label cloned ($BRANCH)"
  }

  checkout "$REPO_BACKEND" "$APP_DIR/backend" "Backend"
  if ! checkout "$REPO_FRONTEND" "$APP_DIR/Frontend" "Frontend"; then
    warn "Could not clone the frontend repository: $REPO_FRONTEND"
    cat <<EOF

  If that repository is private, add this read-only deploy key to it
  (GitHub → repository → Settings → Deploy keys → Add deploy key):

$(cat "$APP_HOME/.ssh/id_ed25519.pub")

  Then run this script again.
EOF
    exit 1
  fi
}

write_backend_env() {
  local env_file="$APP_DIR/backend/.env"
  if [ -f "$env_file" ]; then
    ok "Keeping existing backend/.env"
    return
  fi

  log "Creating backend/.env with fresh secrets"
  local site_url cors admin_password public_ip
  public_ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

  if [ -n "$DOMAIN" ]; then
    site_url="https://$DOMAIN"
    cors="https://$DOMAIN,https://www.$DOMAIN,http://$public_ip"
  else
    site_url="http://$public_ip"
    cors="http://$public_ip"
  fi

  # openssl rand -hex is shell-safe and avoids base64 "/" and "+".
  admin_password="$(openssl rand -hex 10)"

  cat > "$env_file" <<EOF
# Generated by deploy/vps-setup.sh on $(date -u +'%Y-%m-%dT%H:%M:%SZ')
# Keep this file on the server. Never commit it.

NODE_ENV=production

# Server — only Nginx should reach the API.
PORT=4000
HOST=127.0.0.1

# Database — local MongoDB on this VPS.
MONGODB_URI=mongodb://127.0.0.1:27017/$MONGO_DB

# Browser origins allowed to call the API.
CORS_ORIGIN=$cors

# Auth
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_EXPIRES_IN=7d
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$admin_password
ADMIN_NAME=Administrator

# Email (optional). Without SMTP, bookings still work and email is skipped.
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_TLS_RELAXED=false
MAIL_FROM="MC Paradise Apartment <no-reply@${DOMAIN:-localhost}>"
PUBLIC_SITE_URL=$site_url
SUPPORT_PHONE=+250 788 382 569

# Image uploads (optional). Without Cloudinary the dashboard disables them.
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=mc-paradise

# Security
ENCRYPTION_KEY=$(openssl rand -hex 32)
EOF

  chown "$APP_USER:$APP_USER" "$env_file"
  chmod 600 "$env_file"
  ok "backend/.env created"
  ADMIN_PASSWORD_CREATED="$admin_password"
}

configure_pm2_boot() {
  log "Enabling PM2 on boot"
  local pm2_bin
  pm2_bin="$(command -v pm2)"
  if [ "$APP_USER" = "root" ]; then
    env PATH="$PATH" "$pm2_bin" startup systemd -u root --hp /root >/dev/null 2>&1 \
      || warn "Could not install the PM2 systemd unit."
  else
    env PATH="$PATH" "$pm2_bin" startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null 2>&1 \
      || warn "Could not install the PM2 systemd unit."
  fi
  ok "PM2 resume on boot configured"
}

configure_nginx() {
  log "Configuring Nginx"
  local server_name app_dir
  if [ -n "$DOMAIN" ]; then
    server_name="$DOMAIN www.$DOMAIN"
  else
    server_name="_"
  fi
  app_dir="${APP_DIR%/}"

  # Never overwrite the HTTPS server block that Certbot added.
  if grep -q 'managed by Certbot' /etc/nginx/sites-available/mc-paradise 2>/dev/null; then
    log "Existing Nginx config already has HTTPS — keeping it"
  else
    sed -e "s|__SERVER_NAME__|$server_name|g" \
        -e "s|__APP_DIR__|$app_dir|g" \
        "$HERE/nginx/mc-paradise.conf.template" \
        > /etc/nginx/sites-available/mc-paradise
  fi

  ln -sf /etc/nginx/sites-available/mc-paradise /etc/nginx/sites-enabled/mc-paradise
  rm -f /etc/nginx/sites-enabled/default

  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
  ok "Nginx site enabled"
}

configure_firewall() {
  log "Configuring the firewall"
  ufw allow "$SSH_PORT/tcp" >/dev/null
  # Harmless if sshd does not listen on 22; protects you if it does.
  ufw allow 22/tcp >/dev/null
  ufw allow 'Nginx Full' >/dev/null
  ufw --force enable >/dev/null
  ok "UFW allows SSH ($SSH_PORT/tcp), HTTP and HTTPS"
}

enable_https() {
  if [ -z "$DOMAIN" ] || [ -z "$LE_EMAIL" ]; then
    warn "HTTPS skipped (DOMAIN or LE_EMAIL is empty)."
    return
  fi

  log "Checking DNS for $DOMAIN"
  local public_ip dns_ip cert_domains=(-d "$DOMAIN")
  public_ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  dns_ip="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"

  if [ -z "$public_ip" ] || [ "$dns_ip" != "$public_ip" ]; then
    warn "DNS mismatch: $DOMAIN -> '${dns_ip:-nothing}', this VPS -> '${public_ip:-unknown}'."
    warn "Add the A records in Namecheap (or your DNS panel), wait for propagation,"
    warn "then run:  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
    return
  fi

  if [ "$(getent ahostsv4 "www.$DOMAIN" | awk 'NR==1{print $1}' || true)" = "$public_ip" ]; then
    cert_domains+=(-d "www.$DOMAIN")
  fi

  log "Requesting a Let's Encrypt certificate"
  if certbot --nginx "${cert_domains[@]}" --non-interactive --agree-tos \
      -m "$LE_EMAIL" --redirect --keep-until-expiring; then
    ok "HTTPS enabled for $DOMAIN"
  else
    warn "Certbot failed. Port 80 must be open in your provider's firewall/security group."
    warn "Once fixed, run: sudo certbot --nginx ${cert_domains[*]} --redirect"
  fi
}

summary() {
  local public_ip
  public_ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

  cat <<EOF

============================================================
  MC Paradise Apartment — VPS ready
============================================================
  Site         : ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$public_ip}
  Admin        : ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$public_ip}/admin/login
  API health   : ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$public_ip}/api/health
  App folder   : $APP_DIR
  Process      : pm2 (mc-paradise-api), user $APP_USER
  Database     : local MongoDB, db '$MONGO_DB'

  Admin login  : admin
  Admin password: ${ADMIN_PASSWORD_CREATED:-(unchanged — see backend/.env)}

  Update later : sudo -u $APP_USER bash $HERE/vps-deploy.sh
  Logs         : sudo -u $APP_USER pm2 logs mc-paradise-api
============================================================
EOF

  if [ -n "${ADMIN_PASSWORD_CREATED:-}" ]; then
    warn "Store that admin password now — it is not shown again."
  fi
}

main() {
  require_root
  validate
  install_packages
  install_mongodb
  create_user
  clone_repos
  write_backend_env
  configure_pm2_boot
  configure_nginx
  configure_firewall
  enable_https

  if [ "$SKIP_DEPLOY" = "1" ]; then
    warn "SKIP_DEPLOY=1 — not building/starting the app."
  else
    log "Building and starting the app"
    runuser -u "$APP_USER" -- bash "$HERE/vps-deploy.sh"
  fi

  summary
}

main "$@"
