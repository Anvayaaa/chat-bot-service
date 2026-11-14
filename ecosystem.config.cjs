/**
 * PM2 configuration for chat-bot-service (same setup as the CRM API).
 *
 * Start in production with:
 *   pm2 start ecosystem.config.cjs --env production
 */
module.exports = {
  apps: [
    {
      name: "chat-bot-service",
      cwd: __dirname,
      script: "npm",
      args: "start",
      interpreter: "none",

      // One process: the per-minute limit is kept in memory.
      exec_mode: "fork",
      instances: 1,

      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      restart_delay: 3000,
      // Lets in-flight replies finish on restart (see src/server.js).
      kill_timeout: 10000,

      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env_production: {
        NODE_ENV: "production",
        PORT: 5100,
      },
    },
  ],
};
