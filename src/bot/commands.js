const { bot } = require('./telegram');
const config = require('../config');
const ltm = require('../memory/ltm');
const { pool } = require('../database/pool');

function registerCommands({ resetSession, getStatus, getRecentDiaries }) {
  
  const isUser = (id) => id === config.ALLOWED_USER_ID;

  bot.onText(/\/reset/, async (msg) => {
    if (!isUser(msg.from.id)) return;
    resetSession(`tg_${msg.from.id}`);
    await bot.sendMessage(msg.chat.id, "Memory wiped. Who are you again? Just kidding — fresh start.");
  });

  bot.onText(/\/status/, async (msg) => {
    if (!isUser(msg.from.id)) return;
    const status = getStatus ? getStatus() : { uptime: 'unknown', messages: 'unknown' };
    const memUsage = process.memoryUsage();
    
    const text = `📊 *Status*\n\nUptime: ${status.uptime}\nMessages: ${status.messages}\nMemory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`;
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/diary/, async (msg) => {
    if (!isUser(msg.from.id)) return;
    try {
      const diaries = getRecentDiaries ? await getRecentDiaries() : [];
      if (diaries.length === 0) return bot.sendMessage(msg.chat.id, "No diary entries yet.");
      
      const text = '📔 *Recent Diaries*\n\n' + diaries.map((d, i) => 
        `*${new Date(d.created_at).toLocaleDateString()}* — Mood: ${d.mood}\n${d.summary}`
      ).join('\n\n');
      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (err) {
      await bot.sendMessage(msg.chat.id, "Couldn't fetch diary right now.");
    }
  });

  // NEW: /remember
  bot.onText(/\/remember(?:\s+(.+))?/, async (msg, match) => {
    if (!isUser(msg.from.id)) return;
    const memoryText = match[1];
    
    if (!memoryText) {
      return bot.sendMessage(msg.chat.id, "Use the format: /remember [text you want me to save]");
    }
    
    try {
      await ltm.addMemory(msg.from.id, memoryText, 'forced', null, 1.0);
      await bot.sendMessage(msg.chat.id, "Got it. I've locked that into my deep vector memory.");
    } catch (err) {
      await bot.sendMessage(msg.chat.id, "Failed to save memory.");
    }
  });

  // NEW: /tools
  bot.onText(/\/tools/, async (msg) => {
    if (!isUser(msg.from.id)) return;
    try {
      // Flip the tools_enabled boolean
      const res = await pool.query(
        `UPDATE companion_self_state SET tools_enabled = NOT tools_enabled WHERE user_id = $1 RETURNING tools_enabled`,
        [msg.from.id]
      );
      if (res.rows.length === 0) return bot.sendMessage(msg.chat.id, "Companion state not initialized yet.");
      
      const isEnabled = res.rows[0].tools_enabled;
      await bot.sendMessage(msg.chat.id, `⚙️ Agentic Tools are now *${isEnabled ? 'ENABLED' : 'DISABLED'}*.`, { parse_mode: 'Markdown' });
    } catch (err) {
      await bot.sendMessage(msg.chat.id, "Failed to toggle tools.");
    }
  });

// NEW: /retry (Recovery & Regeneration Command)
  bot.onText(/\/retry/, async (msg) => {
    if (!isUser(msg.from.id)) return;
    const sessionId = `tg_${msg.from.id}`;
    const stm = require('../memory/stm');
    const messages = stm.getMessages(sessionId);

    if (messages.length === 0) {
      return bot.sendMessage(msg.chat.id, "I don't have any recent messages to retry.");
    }

    // 1. If the last message was a model reply, pop it (acts as a Regenerate command)
    let lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'model') {
      stm.popLastMessage(sessionId);
    }

    // 2. The last message must now be the user's prompt that we want to retry. Pop it too.
    const userPromptMsg = stm.popLastMessage(sessionId);
    if (!userPromptMsg || userPromptMsg.role !== 'user') {
      return bot.sendMessage(msg.chat.id, "I couldn't find a valid user prompt to retry.");
    }

    await bot.sendMessage(msg.chat.id, `🔄 Retrying: "${userPromptMsg.content}"`);

    // 3. Construct a fake message and run it back through the main process pipeline
    const fakeMsg = {
      ...msg,
      text: userPromptMsg.content
    };

    try {
      await bot.sendChatAction(msg.chat.id, 'typing');
      const reply = await processMessage(fakeMsg);
      if (reply !== null && reply !== undefined) {
        await bot.sendMessage(msg.chat.id, reply);
      }
    } catch (err) {
      console.error('[Retry Command] Error:', err.message);
      await bot.sendMessage(msg.chat.id, "Retry failed. The API provider might still be struggling.");
    }
  });

  bot.onText(/\/help/, async (msg) => {
    if (!isUser(msg.from.id)) return;
    const text = '*Commands:*\n/reset — Clear STM memory\n/status — Health check\n/diary — Read summaries\n/remember [text] — Force save to LTM\n/tools — Toggle AI Agent Tools\n/retry — Regenerate or retry last message\n/help — Show this menu';
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });
}

module.exports = { registerCommands };