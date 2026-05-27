const { chatWithTools, getResponseText, getFunctionCalls } = require('../api/llm');
const { executeTool } = require('./executor');
const { tools } = require('./toolSchemas');
const config = require('../config');

// ADD toolsEnabled parameter (default true)
async function runAgenticLoop(history, toolsEnabled = true) {
  let iteration = 0;
  let finalText = null;
  const currentHistory = [...history];

  while (iteration < config.MAX_TOOL_ITERATIONS) {
    console.log(`[Agent] Loop iteration ${iteration + 1}/${config.MAX_TOOL_ITERATIONS}...`);
    
    // Pass tools only if enabled
    const responseMessage = await chatWithTools(currentHistory, toolsEnabled ? tools : null);
    
    const text = getResponseText(responseMessage);
    const functionCalls = getFunctionCalls(responseMessage);

    if (!functionCalls || functionCalls.length === 0) {
      finalText = text;
      break;
    }

    currentHistory.push(responseMessage);

    for (const call of functionCalls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments); } catch (e) {}

      const result = await executeTool({ name: call.function.name, args });
      
      currentHistory.push({
        role: 'tool',
        tool_call_id: call.id,
        content: String(result)
      });
    }

    iteration++;
  }

  if (!finalText) finalText = "I was thinking so hard about that, I got a little stuck. What were we talking about again?";
  return finalText;
}

module.exports = { runAgenticLoop };