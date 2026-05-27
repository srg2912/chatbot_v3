const ltm = require('../memory/ltm');
const config = require('../config');

async function executeTool(call) {
  const name = call.name;
  const args = call.args || {};

  console.log(`[Agent] Executing tool: ${name}`, args);

  try {
    if (name === 'get_current_time') {
      return new Date().toString();
    }

    if (name === 'search_memory') {
      const results = await ltm.searchMemories(config.ALLOWED_USER_ID, args.query, 3);
      if (results.length === 0) return "No relevant memories found.";
      
      return results.map(r => `(Similarity: ${r.similarity.toFixed(2)}) ${r.content}`).join('\n');
    }

    return `Tool ${name} not recognized.`;
  } catch (err) {
    console.error(`[Agent] Tool ${name} failed:`, err.message);
    return `Error executing tool: ${err.message}`;
  }
}

module.exports = { executeTool };