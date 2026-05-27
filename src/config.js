require('dotenv').config();
const z = require('zod');

// Construct DATABASE_URL from individual PG vars if not provided
const databaseUrl = process.env.DATABASE_URL || 
  `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  GOOGLE_API: z.string().startsWith('AIza'),
  EXA_API: z.string().min(10),
  LLM_API: z.string().min(1),             // NEW
  LLM_ENDPOINT: z.string().url(),         // NEW
  LLM_MODEL: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1),
  BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/),
  ALLOWED_USER_ID: z.string().regex(/^\d+$/).transform(Number),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  WORKSPACE_DIR: z.string().min(1),
  MAX_TOOL_ITERATIONS: z.string().default('3').transform(Number),
  PROACTIVE_COOLDOWN_HOURS: z.string().default('3').transform(Number)
});

// Inject constructed DATABASE_URL before parsing
process.env.DATABASE_URL = databaseUrl;

let env;
try {
  env = envSchema.parse(process.env);
} catch (err) {
  console.error('❌ Environment validation failed:');
  err.errors.forEach(e => console.error(`  - ${e.path.join('.')}: ${e.message}`));
  process.exit(1);
}

module.exports = env;