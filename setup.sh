#!/bin/bash
set -e

echo "=== Companion Autodeploy Script for Pi 3 B+ ==="

# 1. Verify we are in the project root directory
if [ ! -f "package.json" ]; then
  echo "✗ Error: Run this script from the root of your cloned repository (where package.json is located)."
  exit 1
fi

# 2. Check for .env file
if [ ! -f ".env" ]; then
  echo "✗ Error: .env file not found in root directory."
  echo "  Please copy dummydotenv.txt to .env and configure your keys before running this script."
  exit 1
fi

# 3. Read DB parameters from .env dynamically
echo "Reading .env configuration..."
PGUSER=$(grep '^PGUSER=' .env | cut -d '=' -f2)
PGPASSWORD=$(grep '^PGPASSWORD=' .env | cut -d '=' -f2)
PGDATABASE=$(grep '^PGDATABASE=' .env | cut -d '=' -f2)
PGPORT=$(grep '^PGPORT=' .env | cut -d '=' -f2 | tr -d '\r')
PGHOST=$(grep '^PGHOST=' .env | cut -d '=' -f2 | tr -d '\r')

# Fallbacks if some variables are empty in the template
PGUSER=${PGUSER:-bot_user}
PGPASSWORD=${PGPASSWORD:-strong_password}
PGDATABASE=${PGDATABASE:-chatbot_db}
PGPORT=${PGPORT:-5432}
PGHOST=${PGHOST:-127.0.0.1}

echo "Database to configure: $PGDATABASE"
echo "Database user to create: $PGUSER"

# 4. Update and upgrade system packages
echo "Updating system repositories..."
sudo apt update && sudo apt upgrade -y

# 5. Install Node.js 20 (LTS) & build-essential
echo "Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential

# 6. Install PostgreSQL and PostgreSQL Server Development headers
echo "Installing PostgreSQL and development headers..."
sudo apt install -y postgresql postgresql-contrib libpq-dev postgresql-server-dev-all

# 7. Compile and install pgvector from source (UPGRADED to v0.7.0 to support halfvec)
echo "Compiling and installing pgvector..."
rm -rf /tmp/pgvector
git clone --branch v0.7.0 https://github.com/pgvector/pgvector.git /tmp/pgvector
cd /tmp/pgvector
make
sudo make install
cd -

# 8. Tune PostgreSQL Configuration for 1GB RAM limits
echo "Tuning PostgreSQL for 1GB RAM..."
CONF_FILE=$(find /etc/postgresql/ -name "postgresql.conf" | head -n 1)

if [ -f "$CONF_FILE" ]; then
  # Append to end of file (overwriting defaults safely)
  sudo bash -c "cat >> $CONF_FILE" <<EOF

# --- Companion Performance Tuning (1GB RAM Optimized) ---
shared_buffers = 64MB
work_mem = 4MB
maintenance_work_mem = 32MB
effective_cache_size = 256MB
max_connections = 10
wal_buffers = 16MB
checkpoint_completion_target = 0.9
synchronous_commit = off
random_page_cost = 1.1
max_worker_processes = 2
max_parallel_workers = 1
max_parallel_workers_per_gather = 1
# --------------------------------------------------------
EOF
  echo "  ✓ Appended memory configurations to $CONF_FILE"
  sudo systemctl restart postgresql
else
  echo "  ⚠ Warning: Could not locate postgresql.conf automatically. Skip tuning."
fi

# 9. Create PostgreSQL User and Database
echo "Configuring PostgreSQL roles..."
sudo -u postgres psql -c "CREATE ROLE $PGUSER WITH LOGIN PASSWORD '$PGPASSWORD';" || true
sudo -u postgres psql -c "ALTER ROLE $PGUSER WITH PASSWORD '$PGPASSWORD';" || true
sudo -u postgres psql -c "CREATE DATABASE $PGDATABASE OWNER $PGUSER;" || true

# 10. Enable pgvector and grant Schema/Public usage permissions
echo "Enabling pgvector extension and granting schema rights..."
# Drop old extension version first to cleanly register the compiled v0.7.0 build
sudo -u postgres psql -d $PGDATABASE -c "DROP EXTENSION IF EXISTS vector CASCADE;"
sudo -u postgres psql -d $PGDATABASE -c "CREATE EXTENSION IF NOT EXISTS vector;"
sudo -u postgres psql -d $PGDATABASE -c "GRANT USAGE ON SCHEMA public TO $PGUSER;"
sudo -u postgres psql -d $PGDATABASE -c "GRANT ALL PRIVILEGES ON DATABASE $PGDATABASE TO $PGUSER;"
sudo -u postgres psql -d $PGDATABASE -c "GRANT ALL ON SCHEMA public TO $PGUSER;"

# 11. Run SQL Schema as the bot_user (ensures proper table ownership)
echo "Executing database schema..."
if [ -f "src/database/schema.sql" ]; then
  PGPASSWORD=$PGPASSWORD psql -h 127.0.0.1 -U $PGUSER -d $PGDATABASE -f src/database/schema.sql
  echo "  ✓ Schema executed successfully."
else
  echo "  ✗ Error: src/database/schema.sql not found."
  exit 1
fi

# 12. Install local npm dependencies
echo "Installing project dependencies..."
npm install

# 13. Install PM2 and configure Autostart
echo "Setting up PM2..."
sudo npm install -g pm2

# Clear any previous PM2 process named 'companion'
pm2 delete companion || true

# Start application
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "=================================================="
echo "✓ SETUP COMPLETED SUCCESSFULLY!"
echo "=================================================="
echo "Kate is now running headless in the background."
echo ""
echo "To monitor live logs: pm2 logs companion"
echo "To check system health: curl http://localhost:3000/health"
echo "To set up Pi boot start, run: pm2 startup"
echo "=================================================="