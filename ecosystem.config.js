module.exports = {
  apps: [{
    name: "codefarm",
    script: "app.py",
    interpreter: "python3",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      PORT: 8000
    },
    env_production: {
      NODE_ENV: "production"
    },
    error_file: "logs/err.log",
    out_file: "logs/out.log",
    log_file: "logs/combined.log",
    time: true
  }]
};
