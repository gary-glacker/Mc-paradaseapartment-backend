/* ============================================================
   PM2 process definition for the MC Paradise API.
   ------------------------------------------------------------
   Started by vps-deploy.sh with:
     pm2 startOrReload deploy/ecosystem.config.cjs
   `cwd` resolves to <APP_DIR>/backend because this file lives in
   <APP_DIR>/deploy, so the path works for any APP_DIR.
   ============================================================ */

const path = require('node:path')

module.exports = {
  apps: [
    {
      name: 'mc-paradise-api',
      cwd: path.resolve(__dirname, '..', 'backend'),
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 10_000,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
