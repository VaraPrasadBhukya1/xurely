// pm2.config.js — Production process manager config
// Usage: pm2 start pm2.config.js
module.exports = {
  apps: [{
    name:             'xurely-bot',
    script:           'server.js',
    instances:        1,               // increase to 'max' only if you add Redis sessions
    exec_mode:        'fork',
    watch:            false,
    max_memory_restart: '400M',

    // Restart policy
    restart_delay:    5000,            // wait 5s before restart
    max_restarts:     10,
    min_uptime:       '10s',           // must stay up 10s to count as stable

    // Logs
    error_file:       '/var/log/xurely/error.log',
    out_file:         '/var/log/xurely/out.log',
    log_date_format:  'YYYY-MM-DD HH:mm:ss',
    merge_logs:       true,

    env_production: {
      NODE_ENV: 'production',
      PORT:     3000,
    },
  }],
};
