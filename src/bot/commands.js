const { bot } = require('./telegram');
const config = require('../config');

function registerCommands({ resetSession, getStatus }) {
  // /reset — clear conversation history
  bot.onText(/\/reset/, async (msg) => {
    if (msg.from.id !== config.ALLOWED_USER_ID) return;
    
    const sessionId = `tg_${msg.from.id}`;
    resetSession(sessionId);
    
    await bot.sendMessage(msg.chat.id, "Memory wiped. Who are you again? Just kidding — fresh start.");
  });

  // /status — show bot health
  bot.onText(/\/status/, async (msg) => {
    if (msg.from.id !== config.ALLOWED_USER_ID) return;
    
    const status = getStatus ? getStatus() : { uptime: 'unknown', messages: 'unknown' };
    const memUsage = process.memoryUsage();
    
    const text = [
      '📊 *Status*',
      '',
      `Uptime: ${status.uptime}`,
      `Messages handled: ${status.messages}`,
      '',
      `Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      `RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    ].join('\n');
    
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  // /help — list commands
  bot.onText(/\/help/, async (msg) => {
    if (msg.from.id !== config.ALLOWED_USER_ID) return;
    
    const text = [
      '*Commands:*',
      '',
      '/reset — Clear conversation memory',
      '/status — Show bot health',
      '/help — This message',
      '',
      'More coming in later phases.'
    ].join('\n');
    
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });
}

module.exports = { registerCommands };