const tools = [
  {
    name: "get_current_time",
    description: "Get the current real-world time and date.",
    parameters: {
      type: "OBJECT",
      properties: {},
      required: []
    }
  },
  {
    name: "search_memory",
    description: "Search the user's long-term vector memory for past events, facts, or context.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "The question or topic to search for in memory."
        }
      },
      required: ["query"]
    }
  }
];

module.exports = { tools };