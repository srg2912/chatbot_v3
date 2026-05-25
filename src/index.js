require('dotenv').config();
const express = require('express');
const config = require('./config');
const { pool, closePool } = require('./database/pool');
const { bot, setProcessMessage, setReady, stopBot } = require('./bot/telegram');
const { registerCommands } = require('./bot/commands');

// Simple stats tracker
const stats = {
  startTime: Date.now(),
  messagesHandled: 0,
};

function getStatus() {
  const uptimeMs = Date.now() - stats.startTime;
  const hours = Math.floor(uptimeMs / 3600000);
  const minutes = Math.floor((uptimeMs % 3600000) / 60000);
  return {
    uptime: `${hours}h ${minutes}m`,
    messages: stats.messagesHandled,
  };
}

// Echo processor for Phase 2 (will be replaced in later phases)
async function processMessage(msg) {
  stats.messagesHandled++;
  
  const text = msg.text;
  
  // Handle commands (they're already handled by bot.onText, but double-check)
  if (text.startsWith('/')) {
    return null; // Let command handlers deal with it
  }
  
  // Simple echo with personality for Phase 2
  return `You said: "${text}"\n\n(Phase 2 echo — real brain coming in Phase 3)`;
}

// Register commands
registerCommands({
  resetSession: (sessionId) => {
    console.log(`[Commands] Reset session ${sessionId}`);
    // STM reset will be wired in Phase 4
  },
  getStatus,
});

// Set the message processor
setProcessMessage(processMessage);

// Express health check (lightweight, for monitoring)
const app = express();
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: getStatus().uptime,
    messages: stats.messagesHandled,
    memory: process.memoryUsage(),
  });
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  setReady(false);
  await stopBot();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start
(async () => {
  try {
    // Verify DB connection
    const client = await pool.connect();
    const dbResult = await client.query('SELECT NOW() as now');
    console.log(`[DB] Connected. Server time: ${dbResult.rows[0].now}`);
    client.release();

    // Start Express
    app.listen(config.PORT, () => {
      console.log(`[HTTP] Health check on http://localhost:${config.PORT}/health`);
    });

    // Mark bot ready
    setReady(true);
    console.log('[Bot] Ready and polling for messages...');
    console.log(`[Bot] Authorized user ID: ${config.ALLOWED_USER_ID}`);

  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
})();