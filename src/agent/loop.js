const { chatWithTools, getResponseText, getFunctionCalls } = require('../api/llm');
const { executeTool } = require('./executor');
const { tools } = require('./toolSchemas');
const config = require('../config');

async function runAgenticLoop(history) {
  let iteration = 0;
  let finalText = null;
  const currentHistory = [...history]; // Clone the history array

  while (iteration < config.MAX_TOOL_ITERATIONS) {
    console.log(`[Agent] Loop iteration ${iteration + 1}/${config.MAX_TOOL_ITERATIONS}...`);
    
    // 1. Call LLM
    const responseMessage = await chatWithTools(currentHistory, tools);
    const text = getResponseText(responseMessage);
    const functionCalls = getFunctionCalls(responseMessage);

    // 2. No tools called = final answer
    if (!functionCalls || functionCalls.length === 0) {
      finalText = text;
      break;
    }

    // 3. Tools called! Add the assistant's request to history
    currentHistory.push(responseMessage);

    // Execute sequentially
    for (const call of functionCalls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments); } catch (e) {}

      // executeTool is from executor.js (same as the one you wrote previously)
      const result = await executeTool({ name: call.function.name, args });
      
      // Add the tool result to history
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