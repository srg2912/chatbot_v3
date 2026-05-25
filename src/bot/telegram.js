const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

// Rate limiter: simple in-memory sliding window
const userWindows = new Map();

// Track if bot is ready (set by index.js)
let isReady = false;
let processMessageFn = null;

function setProcessMessage(fn) {
  processMessageFn = fn;
}

function setReady(value) {
  isReady = value;
}

// Single-user gate + rate limiting
bot.on('message', async (msg) => {
  // HARD GATE: Only ALLOWED_USER_ID
  if (msg.from.id !== config.ALLOWED_USER_ID) {
    return; // Silent ignore
  }

  // Ignore non-text messages for now
  if (!msg.text) return;

  // Rate limit: max 20 per minute
  const now = Date.now();
  const window = userWindows.get(msg.from.id) || [];
  const recent = window.filter(t => now - t < 60000);
  if (recent.length >= 20) {
    await bot.sendMessage(msg.chat.id, "Slow down! I'm just a Pi.");
    return;
  }
  recent.push(now);
  userWindows.set(msg.from.id, recent);

  // Bot not ready yet
  if (!isReady) {
    await bot.sendMessage(msg.chat.id, "Booting up... one sec.");
    return;
  }

  // Typing indicator
  await bot.sendChatAction(msg.chat.id, 'typing');

  // Process sequentially
  try {
    const reply = await processMessageFn(msg);
    // CRITICAL FIX: Don't send null/undefined (commands handle their own replies)
    if (reply !== null && reply !== undefined) {
      await bot.sendMessage(msg.chat.id, reply);
    }
  } catch (err) {
    console.error('[Telegram] Error processing message:', err);
    await bot.sendMessage(msg.chat.id, "My circuits got tangled. Try again?");
  }
});

// Handle polling errors
bot.on('polling_error', (err) => {
  console.error('[Telegram] Polling error:', err.message);
});

// Graceful stop
async function stopBot() {
  console.log('[Telegram] Stopping polling...');
  await bot.stopPolling();
}

module.exports = { bot, setProcessMessage, setReady, stopBot };