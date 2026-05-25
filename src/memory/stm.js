const { pool } = require('../database/pool');

// In-memory hot storage: key = session_id, value = Array<{role, content, tokens, created_at}>
const sessions = new Map();
const MAX_STM_TOKENS = 6000;

function addMessage(sessionId, message) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  const session = sessions.get(sessionId);
  session.push(message);

  // Token-aware truncation: drop oldest until under budget
  let total = session.reduce((sum, m) => sum + (m.tokens || 0), 0);
  while (total > MAX_STM_TOKENS && session.length > 1) {
    const removed = session.shift();
    total -= (removed.tokens || 0);
  }
}

/**
 * Get messages fitting within tokenBudget (newest first, returned chronologically)
 */
function getMessages(sessionId, tokenBudget) {
  const session = sessions.get(sessionId) || [];
  const result = [];
  let used = 0;

  for (let i = session.length - 1; i >= 0; i--) {
    const t = session[i].tokens || 0;
    if (used + t > tokenBudget) break;
    used += t;
    result.unshift(session[i]);
  }

  return result;
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
  resetSession,
  popLastMessage,
  persistMessage,
  // Exposed for tests only
  _sessions: sessions,
};