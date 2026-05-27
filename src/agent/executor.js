const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ltm = require('../memory/ltm');
const config = require('../config');
const { validatePath, validateCommand } = require('../utils/security');

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

    if (name === 'get_weather') {
      // wttr.in format=4 prints a beautifully condensed line: "London: 🌦️ +15°C"
      const url = `https://wttr.in/${encodeURIComponent(args.city)}?format=4`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Weather service returned status ${response.status}`);
      return await response.text();
    }

    if (name === 'web_search') {
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'x-api-key': config.EXA_API,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: args.query,
          numResults: 5,
          useAutoprompt: true
        })
      });

      if (!response.ok) {
        throw new Error(`Exa API returned status ${response.status}`);
      }

      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        return "No web results found.";
      }

      return data.results.map((r, i) => 
        `[Result ${i + 1}] Title: ${r.title}\nURL: ${r.url}\nPublished: ${r.publishedDate || 'N/A'}\n---`
      ).join('\n\n');
    }

    if (name === 'write_file') {
      // Ensure the workspace directory physically exists first
      if (!fs.existsSync(config.WORKSPACE_DIR)) {
        fs.mkdirSync(config.WORKSPACE_DIR, { recursive: true });
      }

      const safePath = validatePath(args.filename);
      fs.writeFileSync(safePath, args.content, 'utf8');
      return `Successfully wrote file: ${args.filename}`;
    }

    if (name === 'read_file') {
      const safePath = validatePath(args.filename);
      if (!fs.existsSync(safePath)) {
        return `Error: File ${args.filename} does not exist.`;
      }
      return fs.readFileSync(safePath, 'utf8');
    }

    if (name === 'list_files') {
      if (!fs.existsSync(config.WORKSPACE_DIR)) {
        return "Workspace directory is empty.";
      }
      const files = fs.readdirSync(config.WORKSPACE_DIR);
      if (files.length === 0) return "No files in workspace.";
      return files.join('\n');
    }

    if (name === 'execute_command') {
      const safeCommand = validateCommand(args.command);
      
      // Execute within workspace context safely
      const output = execSync(safeCommand, {
        cwd: config.WORKSPACE_DIR,
        timeout: 10000, // 10s CPU timeout safeguard for Pi 3
        env: { ...process.env }
      });
      
      return output.toString() || "Command completed with empty output.";
    }

    return `Tool ${name} not recognized.`;
  } catch (err) {
    console.error(`[Agent] Tool ${name} failed:`, err.message);
    return `Error executing tool: ${err.message}`;
  }
}

module.exports = { executeTool };