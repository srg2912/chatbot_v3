const cron = require('node-cron');
const config = require('../config');

// Import all cognitive engines
const { consolidatePatterns } = require('../memory/habits');
const { decayConfidence } = require('../memory/facts');
const { cleanupOldMessages } = require('../memory/stm');
const { embedUnprocessedDiaries } = require('../memory/ltm');
const { generateReflection } = require('../personality/reflection');
const { mutatePersonality } = require('../personality/engine');
const { evolveState } = require('../memory/companionState');

async function runNightlyMaintenance() {
  const userId = config.ALLOWED_USER_ID;
  console.log('[Nightly] Starting sequential maintenance loop...');
  
  try {
    console.log('[Nightly] 1/7: Consolidating Habits (Spaced Repetition)...');
    await consolidatePatterns(userId);
    
    console.log('[Nightly] 2/7: Decaying Fact Confidence...');
    await decayConfidence(userId);
    
    console.log('[Nightly] 3/7: Cleaning up old STM messages (> 14 days)...');
    await cleanupOldMessages(userId);
    
    console.log('[Nightly] 4/7: Embedding unprocessed diaries to LTM...');
    await embedUnprocessedDiaries(userId);
    
    console.log('[Nightly] 5/7: Generating Nightly Reflection...');
    const reflection = await generateReflection(userId);
    
    if (reflection) {
        console.log('[Nightly] 6/7: Mutating Personality...');
        await mutatePersonality(userId, reflection.reflection_text);
        
        console.log('[Nightly] 7/7: Evolving Companion State...');
        await evolveState(userId, reflection.reflection_text);
    } else {
        console.log('[Nightly] 6-7/7: Skipped (No reflection generated)');
    }
    
    console.log('[Nightly] All maintenance tasks completed successfully.');
  } catch (err) {
    console.error('[Nightly] Task failed:', err);
  }
}

// Automatically runs at 3:00 AM daily
cron.schedule('0 3 * * *', runNightlyMaintenance);

module.exports = { runNightlyMaintenance };