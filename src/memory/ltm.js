const { pool } = require('../database/pool');
const { embedText } = require('../api/llm');

/**
 * Add a new memory to Long Term Memory (LTM)
 * @param {number} userId - The user's Telegram ID
 * @param {string} content - The text content to remember
 * @param {string} source - 'message', 'diary', 'forced', or 'reflection'
 * @param {number|null} sourceId - ID from the source table (if applicable)
 * @param {number} importance - 0.0 to 1.0 (how critical this memory is)
 */
async function addMemory(userId, content, source = 'forced', sourceId = null, importance = 0.5) {
  // 1. Get embedding sequentially
  const embedding = await embedText(content);
  
  // Convert array to string format expected by pgvector: '[0.1, 0.2, ...]'
  const embeddingStr = JSON.stringify(embedding);

  // 2. Store in PSQL
  const result = await pool.query(
    `INSERT INTO vector_memories (user_id, content, embedding, source, source_id, importance)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, content, embeddingStr, source, sourceId, importance]
  );
  
  return result.rows[0].id;
}

/**
 * Search LTM for the most relevant memories using cosine similarity
 * @param {number} userId - The user's Telegram ID
 * @param {string} queryText - The text to search for
 * @param {number} limit - Maximum number of memories to return (default 5)
 */
async function searchMemories(userId, queryText, limit = 5) {
  // 1. Get embedding for the query sequentially
  const queryEmbedding = await embedText(queryText);
  const embeddingStr = JSON.stringify(queryEmbedding);

  // 2. Perform cosine similarity search
  // The <=> operator in pgvector calculates cosine distance. 
  // We do 1 - distance to get similarity (1.0 = exact match, 0.0 = completely different).
  const result = await pool.query(
    `SELECT id, content, source, importance, 
            1 - (embedding <=> $1) AS similarity 
     FROM vector_memories 
     WHERE user_id = $2
     ORDER BY embedding <=> $1 
     LIMIT $3`,
    [embeddingStr, userId, limit]
  );

  return result.rows;
}

module.exports = {
  addMemory,
  searchMemories
};