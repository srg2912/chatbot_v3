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
          query: { type: "string", description: "The question or topic to search for in memory." }
        },
        required: ["query"]
      }
    }
  }
];

module.exports = { tools };