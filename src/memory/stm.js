const { pool } = require('../database/pool');

const MAX_STM_MESSAGES = 20; // Hard FIFO limit

// In-memory hot storage: key = session_id, value = Array<{role, content, tokens, created_at}>
const sessions = new Map();

function addMessage(sessionId, message) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  const session = sessions.get(sessionId);
  session.push(message);

  // FIFO: drop oldest if over limit
  while (session.length > MAX_STM_MESSAGES) {
    session.shift();
  }
}

/**
 * Get all messages in STM (up to MAX_STM_MESSAGES, chronologically ordered)
 */
function getMessages(sessionId) {
  return sessions.get(sessionId) || [];
}

/**
 * Get message count in STM
 */
function getMessageCount(sessionId) {
  return (sessions.get(sessionId) || []).length;
}

function resetSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Remove the most recently added message (used when Gemini fails to prevent duplicates)
 */
function popLastMessage(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.length > 0) {
    return session.pop();
  }
  return null;
}

// Async backup to PSQL (fire-and-forget, non-blocking)
async function persistMessage(db, msg) {
  await db.query(
    `INSERT INTO messages (user_id, role, content, tokens, session_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [msg.user_id, msg.role, msg.content, msg.tokens, msg.session_id]
  );
}

module.exports = {
  addMessage,
  getMessages,
  getMessageCount,
  resetSession,
  popLastMessage,
  persistMessage,
  MAX_STM_MESSAGES,
  // Exposed for tests only
  _sessions: sessions,
};