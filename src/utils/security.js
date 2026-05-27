const path = require('path');
const config = require('../config');

const ALLOWED_SHELL_COMMANDS = ['ls', 'cat', 'grep', 'find', 'python3', 'node', 'pwd', 'echo'];
const FORBIDDEN_PATTERNS = /[;&|`\$\(\)\{\}\[\]\\]|rm\s|dd\s|mkfs|sudo|>|</;

function validatePath(inputPath) {
  const resolved = path.resolve(config.WORKSPACE_DIR, inputPath);
  if (!resolved.startsWith(path.resolve(config.WORKSPACE_DIR))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function validateCommand(cmd) {
  if (FORBIDDEN_PATTERNS.test(cmd)) {
    throw new Error('Forbidden characters in command');
  }
  const base = cmd.trim().split(' ')[0];
  if (!ALLOWED_SHELL_COMMANDS.includes(base)) {
    throw new Error(`Command not in whitelist: ${base}`);
  }
  return cmd;
}

module.exports = { validatePath, validateCommand };