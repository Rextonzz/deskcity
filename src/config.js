import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The tests (npm test) point the hub's data at a throwaway folder with HUB_TEST_ROOT, so they never touch the real
// data/ or .env. The pages still come from the app's own folder.
const rootDir = process.env.HUB_TEST_ROOT ? path.resolve(process.env.HUB_TEST_ROOT) : appDir;

export const config = {
  port: Number(process.env.PORT) || 3000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY, // reserved for future Gemini features
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  rootDir,
  publicDir: path.join(appDir, "public"),
};

// A key that is set and not the "your-..." placeholder from .env.example.
export const isRealKey = (k) => Boolean(k) && !/^your-/.test(k);
export const hasRealAnthropicKey = () => isRealKey(config.anthropicApiKey);
// A key that is there and still holds the "your-..." placeholder. A key that is simply missing is not one: the setup
// guide covers that, so the start-up message stays quiet about it.
export const isPlaceholderKey = (k) => typeof k === "string" && /^your-/.test(k);
export const hasPlaceholderAnthropicKey = () => isPlaceholderKey(config.anthropicApiKey);
