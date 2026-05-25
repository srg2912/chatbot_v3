function estimateTokens(text) {
  if (!text) return 0;
  // Rough heuristic: ~4 chars per token for English/mixed text
  return Math.ceil(text.length / 4);
}

module.exports = { estimateTokens };