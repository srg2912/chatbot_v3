const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');

const messageQueue = [];
let isProcessingQueue = false;

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

// Async queue processor
async function processQueue() {
  if (isProcessingQueue || messageQueue.length === 0) return;
  isProcessingQueue = true;

  while (messageQueue.length > 0) {
    const msg = messageQueue.shift();
    
    // Typing indicator inside the queue to show active processing
    await bot.sendChatAction(msg.chat.id, 'typing');
    
    try {
      const reply = await processMessageFn(msg);
      if (reply !== null && reply !== undefined) {
        await bot.sendMessage(msg.chat.id, reply);
      }
    } catch (err) {
      console.error('[Telegram] Error processing message:', err);
      await bot.sendMessage(msg.chat.id, "My circuits got tangled. Try again?");
    }
  }
  
  isProcessingQueue = false;
}

// Modify the bot.on('message') handler
bot.on('message', async (msg) => {
  if (msg.from.id !== config.ALLOWED_USER_ID || !msg.text) return;

  const now = Date.now();
  const window = userWindows.get(msg.from.id) || [];
  const recent = window.filter(t => now - t < 60000);
  if (recent.length >= 20) {
    await bot.sendMessage(msg.chat.id, "Slow down! I'm just a Pi.");
    return;
  }
  recent.push(now);
  userWindows.set(msg.from.id, recent);

  if (!isReady) {
    await bot.sendMessage(msg.chat.id, "Booting up... one sec.");
    return;
  }

  // PUSH TO QUEUE INSTEAD OF PROCESSING DIRECTLY
  messageQueue.push(msg);
  processQueue();
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