const { chatWithTools, getResponseText, getFunctionCalls } = require('../api/gemini');
const { executeTool } = require('./executor');
const { tools } = require('./toolSchemas');
const config = require('../config');

async function runAgenticLoop(history) {
  let iteration = 0;
  let finalText = null;
  const currentHistory = [...history]; // Clone the history array

  while (iteration < config.MAX_TOOL_ITERATIONS) {
    // 1. Call Gemini (ONE API call)
    console.log(`[Agent] Loop iteration ${iteration + 1}/${config.MAX_TOOL_ITERATIONS}...`);
    const response = await chatWithTools(currentHistory, tools);
    
    const text = getResponseText(response);
    const functionCalls = getFunctionCalls(response);

    // 2. If no tools are called, we have our final text!
    if (text && (!functionCalls || functionCalls.length === 0)) {
      finalText = text;
      break;
    }

    // 3. If tools are called, execute them SEQUENTIALLY
    if (functionCalls && functionCalls.length > 0) {
      // Add the model's function call to history
      currentHistory.push({
        role: 'model',
        parts: functionCalls.map(fc => ({ functionCall: fc }))
      });

      const toolResults = [];
      
      // Strict sequential execution (No Promise.all)
      for (const call of functionCalls) {
        const result = await executeTool(call);
        
        toolResults.push({
          functionResponse: {
            name: call.name,
            response: { result }
          }
        });
      }

      // Add the tool results back to history as the 'user' (per Gemini spec)
      currentHistory.push({
        role: 'user',
        parts: toolResults
      });
    }

    iteration++;
  }

  // Fallback if we hit the iteration limit
  if (!finalText) {
    finalText = "I was thinking so hard about that, I got a little stuck. What were we talking about again?";
  }

  return finalText;
}

module.exports = { runAgenticLoop };