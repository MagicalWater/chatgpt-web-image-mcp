import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer, isMainModule } from "../src/mcp-server.js";

test("recognizes the Windows executable entrypoint via file URL conversion", () => {
  assert.equal(
    isMainModule(
      "file:///D:/Developer/chatgpt-web-image-mcp-admission/src/mcp-server.js",
      "D:\\Developer\\chatgpt-web-image-mcp-admission\\src\\mcp-server.js",
    ),
    true,
  );
});

test("an MCP client can discover and call the image tools", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-web-image-mcp-test-"));
  const imagePath = path.join(root, "result.png");
  const imageBytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
  await fs.writeFile(imagePath, imageBytes);

  const fakeGenerator = {
    async check(input) {
      assert.equal(input.surface, "images");
      return { ready: true, browserMode: "test" };
    },
    async generate(input) {
      assert.equal(input.prompt, "draw a test image");
      assert.equal(input.surface, "images");
      assert.equal(input.character_profile, "same character");
      return {
        ok: true,
        jobId: "job-test",
        surface: "images",
        chatgptUrl: "https://chatgpt.com/images/",
        consistency: { character: true, style: false },
        images: [
          {
            filePath: imagePath,
            mimeType: "image/png",
            bytes: imageBytes.length,
            width: 1024,
            height: 1024,
            captureMethod: "test",
          },
        ],
      };
    },
    async setupProject(input) {
      assert.equal(input.project_name, "Image continuity");
      return {
        ok: true,
        created: true,
        projectUrl: "https://chatgpt.com/g/g-p-test/project",
      };
    },
    async close() {},
  };
  const config = { maxImageBytes: 1024 };
  const { server } = createServer(config, { generator: fakeGenerator });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "check_chatgpt_image_browser",
      "generate_chatgpt_web_image",
      "setup_chatgpt_image_project",
    ],
  );

  const status = await client.callTool({
    name: "check_chatgpt_image_browser",
    arguments: { surface: "images" },
  });
  assert.equal(status.isError, undefined);
  assert.match(status.content[0].text, /"ready": true/);

  const setup = await client.callTool({
    name: "setup_chatgpt_image_project",
    arguments: { project_name: "Image continuity" },
  });
  assert.equal(setup.isError, undefined);
  assert.match(setup.content[0].text, /g-p-test/);

  const result = await client.callTool({
    name: "generate_chatgpt_web_image",
    arguments: {
      prompt: "draw a test image",
      surface: "images",
      character_profile: "same character",
    },
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /"surface": "images"/);
  assert.match(result.content[0].text, /"character": true/);
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].data, imageBytes.toString("base64"));
});
