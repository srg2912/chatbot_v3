const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 5,                    // Pi RAM constraint
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
  process.exit(-1);
});

// Graceful shutdown helper
async function closePool() {
  console.log('Closing database pool...');
  await pool.end();
}

module.exports = { pool, closePool };