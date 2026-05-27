module.exports = {
  apps: [{
    name: 'companion',
    script: './src/index.js',
    instances: 1,                 // Strict single instance to prevent concurrency issues
    exec_mode: 'fork',            // Fork mode to preserve single-user state in memory
    max_memory_restart: '450M',   // Restart process if it exceeds 450MB RSS
    node_args: '--max-old-space-size=400', // Restrict V8 heap size to 400MB
    env: {
      NODE_ENV: 'production'
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    err_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    kill_timeout: 5000            // Graceful shutdown timeout (5 seconds)
  }]
};