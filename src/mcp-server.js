#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { safeError } from "./errors.js";
import { ImageGenerator } from "./generator.js";
import { toMcpContent } from "./mcp-result.js";

export function createServer(config = loadConfig(), dependencies = {}) {
  const generator = dependencies.generator || new ImageGenerator(config);
  const server = new McpServer({ name: "chatgpt-web-image", version: "0.1.0" });

  server.registerTool(
    "check_chatgpt_image_browser",
    {
      title: "Check ChatGPT image browser",
      description: "Check whether the dedicated local Chrome profile is signed in and ready.",
      inputSchema: {},
    },
    async () => {
      try {
        const status = await generator.check();
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      } catch (error) {
        const safe = safeError(error);
        return { isError: true, content: [{ type: "text", text: JSON.stringify(safe) }] };
      }
    },
  );

  server.registerTool(
    "generate_chatgpt_web_image",
    {
      title: "Generate image in ChatGPT web",
      description:
        "Use the operator's dedicated, logged-in local ChatGPT web session to generate an image and return the captured image content. Calls are serialized.",
      inputSchema: {
        prompt: z.string().min(1).max(12000).describe("Image generation or editing prompt"),
        source_images: z
          .array(z.string())
          .max(8)
          .optional()
          .describe("Optional local image paths under CHATGPT_IMAGE_ALLOWED_INPUT_DIRS"),
        chatgpt_url: z
          .string()
          .url()
          .optional()
          .describe("Optional HTTPS chatgpt.com conversation or project URL"),
      },
    },
    async (input) => {
      try {
        const result = await generator.generate(input);
        return { content: await toMcpContent(result, config.maxImageBytes) };
      } catch (error) {
        const safe = safeError(error);
        return { isError: true, content: [{ type: "text", text: JSON.stringify(safe) }] };
      }
    },
  );

  return { server, generator };
}

export async function main() {
  const { server, generator } = createServer();
  const shutdown = async () => {
    await generator.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const safe = safeError(error);
    process.stderr.write(`${safe.code}: ${safe.message}\n`);
    process.exitCode = 1;
  });
}
