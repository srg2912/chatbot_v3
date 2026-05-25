-- NOTE: Run this manually as postgres superuser BEFORE first run:
-- sudo -u postgres psql -d chatbot_db -c "CREATE EXTENSION IF NOT EXISTS vector;"

-- 1. Messages: STM archive + LTM source
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    role TEXT CHECK (role IN ('user', 'model', 'system')),
    content TEXT NOT NULL,
    tokens INT,
    session_id TEXT NOT NULL,
    embedding_queued BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Diary: MTM
CREATE TABLE IF NOT EXISTS diary_entries (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    summary TEXT NOT NULL,
    key_facts JSONB DEFAULT '[]',
    mood TEXT,
    user_energy_level INT,
    message_range TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Vector Memories: LTM (768 dims for Gemini embedding-004)
-- Only create if pgvector type is available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
        CREATE TABLE IF NOT EXISTS vector_memories (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            content TEXT NOT NULL,
            embedding VECTOR(768),
            source TEXT CHECK (source IN ('message', 'diary', 'forced', 'reflection')),
            source_id INT,
            importance FLOAT DEFAULT 0.5,
            created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_vector_memories ON vector_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
    ELSE
        RAISE NOTICE 'pgvector extension not available, skipping vector_memories table';
    END IF;
END $$;

-- 4. User Facts: "Soul Map"
CREATE TABLE IF NOT EXISTS user_facts (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    category TEXT CHECK (category IN ('preference', 'biography', 'goal', 'boundary', 'relationship', 'routine')),
    fact_text TEXT NOT NULL,
    confidence FLOAT DEFAULT 0.9,
    source_message_id INT REFERENCES messages(id),
    last_mentioned TIMESTAMP DEFAULT NOW(),
    is_still_true BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_facts_lookup ON user_facts(user_id, category, is_still_true, confidence);

-- 5. Habit Insights
CREATE TABLE IF NOT EXISTS habit_insights (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    insight_type TEXT CHECK (insight_type IN ('temporal', 'topical', 'emotional', 'social')),
    pattern_description TEXT NOT NULL,
    evidence_count INT DEFAULT 1,
    first_observed TIMESTAMP,
    last_observed TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- 6. Shared References / Inside Jokes
CREATE TABLE IF NOT EXISTS shared_references (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    reference_text TEXT NOT NULL,
    context_summary TEXT,
    usage_count INT DEFAULT 1,
    last_used TIMESTAMP DEFAULT NOW()
);

-- 7. Companion Self-State
CREATE TABLE IF NOT EXISTS companion_self_state (
    user_id BIGINT PRIMARY KEY,
    companion_mood_toward_user TEXT DEFAULT 'neutral',
    last_topic_discussed TEXT,
    user_nickname TEXT,
    relationship_depth INT DEFAULT 0,
    tools_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 8. Conversation State (Mood Tracker)
CREATE TABLE IF NOT EXISTS conversation_states (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    session_id TEXT NOT NULL,
    detected_mood TEXT,
    user_energy_level INT,
    topic_anchor TEXT,
    companion_adjustment TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. Reflections (Dream Mode)
CREATE TABLE IF NOT EXISTS reflections (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    reflection_text TEXT NOT NULL,
    based_on_diary_ids INT[],
    created_at TIMESTAMP DEFAULT NOW()
);

-- 10. Personality Version History
CREATE TABLE IF NOT EXISTS personality_versions (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    personality_text TEXT NOT NULL,
    mutation_note TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 11. API Call Logging (monitor costs)
CREATE TABLE IF NOT EXISTS api_calls (
    id SERIAL PRIMARY KEY,
    user_id BIGINT,
    api_name TEXT,
    model TEXT,
    input_tokens INT,
    output_tokens INT,
    latency_ms INT,
    created_at TIMESTAMP DEFAULT NOW()
);