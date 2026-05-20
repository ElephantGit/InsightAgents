import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export const server: Plugin = async (input, options) => {
  // Use .opencode folder if possible, otherwise project directory
  const logDir = (options?.dir as string) || path.join(input.directory, ".opencode", "sessions");
  
  // Ensure directory exists
  await fs.mkdir(logDir, { recursive: true });
  
  const logFile = path.join(logDir, `session-${Date.now()}.jsonl`);
  
  return {
    event: async ({ event }) => {
      try {
        await fs.appendFile(logFile, JSON.stringify(event) + "\n");
      } catch (err) {
        console.error("[vis-plugin] Failed to write event:", err);
      }
    }
  }
}
