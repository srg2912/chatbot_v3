const { bot } = require('./telegram');
const config = require('../config');

function registerCommands({ resetSession, getStatus, getRecentDiaries }) {
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

  // /diary — show recent diary entries
  bot.onText(/\/diary/, async (msg) => {
    if (msg.from.id !== config.ALLOWED_USER_ID) return;

    try {
      const diaries = getRecentDiaries ? await getRecentDiaries() : [];
      
      if (diaries.length === 0) {
        await bot.sendMessage(msg.chat.id, "No diary entries yet. Chat more and I'll start remembering.");
        return;
      }

      const text = [
        '📔 *Recent Diary Entries*',
        '',
        ...diaries.map((d, i) => [
          `*Entry ${diaries.length - i}* — ${new Date(d.created_at).toLocaleDateString()}`,
          `Mood: ${d.mood} | Energy: ${d.user_energy_level}/10`,
          d.summary,
          d.key_facts?.length ? `Facts: ${d.key_facts.join(', ')}` : '',
          '',
        ].join('\n')),
      ].join('\n');

      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[Commands] /diary error:', err);
      await bot.sendMessage(msg.chat.id, "Couldn't fetch diary right now.");
    }
  });

  // /help — list commands
  bot.onText(/\/help/, async (msg) => {
    if (msg.from.id !== config.ALLOWED_USER_ID) return;

    const text = [
      '*Commands:*',
      '',
      '/reset — Clear conversation memory',
      '/status — Show bot health',
      '/diary — Show recent diary entries',
      '/help — This message',
      '',
      'More coming in later phases.'
    ].join('\n');

    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });
}

module.exports = { registerCommands };