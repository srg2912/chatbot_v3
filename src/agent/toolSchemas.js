const tools = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get the current real-world time and date.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "Search the user's long-term vector memory for past events, facts, or context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The question or topic to search for." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a specified city.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "The city name (e.g. 'London', 'Berlin')." }
        },
        required: ["city"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the live web for real-time information, news, or general knowledge using Exa.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query (e.g., 'who won the latest football match')." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or write content to a file inside the designated workspace directory. Path traversal is strictly blocked.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "The name of the file (e.g. 'hello.py' or 'notes.txt')." },
          content: { type: "string", description: "The text content to write into the file." }
        },
        required: ["filename", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the text content of an existing file in the workspace directory.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "The name of the file to read." }
        },
        required: ["filename"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List all files present in the workspace directory.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_command",
      description: "Execute a terminal command inside the workspace directory. Only whitelisted commands are allowed: ls, cat, grep, find, python3, node, pwd, echo.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The sandboxed shell command to execute (e.g., 'node hello.js' or 'python3 script.py')." }
        },
        required: ["command"]
      }
    }
  }
];

module.exports = { tools };