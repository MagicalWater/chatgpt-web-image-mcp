import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  connectWithGracefulShutdown,
  createGracefulShutdown,
  createServer,
  installStdioShutdownHooks,
  isMainModule,
} from "../src/mcp-server.js";
import { UserFacingError } from "../src/errors.js";

test("recognizes the Windows executable entrypoint via file URL conversion", {
  skip: process.platform !== "win32",
}, () => {
  assert.equal(
    isMainModule(
      "file:///D:/Developer/chatgpt-web-image-mcp-admission/src/mcp-server.js",
      "D:\\Developer\\chatgpt-web-image-mcp-admission\\src\\mcp-server.js",
    ),
    true,
  );
});

test("stdio EOF starts one graceful browser shutdown before signal fallback", async () => {
  const input = new EventEmitter();
  const processLike = new EventEmitter();
  let generatorCloseCalls = 0;
  let serverCloseCalls = 0;
  let releaseGeneratorClose;
  const generatorCloseGate = new Promise((resolve) => {
    releaseGeneratorClose = resolve;
  });
  const shutdown = createGracefulShutdown({
    generator: {
      async close() {
        generatorCloseCalls += 1;
        await generatorCloseGate;
      },
    },
    server: {
      async close() {
        serverCloseCalls += 1;
      },
    },
  });
  const removeHooks = installStdioShutdownHooks({ input, processLike, shutdown });

  input.emit("end");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(generatorCloseCalls, 1);

  input.emit("close");
  processLike.emit("SIGTERM");
  releaseGeneratorClose();
  await shutdown();

  assert.equal(generatorCloseCalls, 1);
  assert.equal(serverCloseCalls, 1);
  removeHooks();
});

test("stdio shutdown hooks remain active after server connect resolves", async () => {
  const input = new EventEmitter();
  const processLike = new EventEmitter();
  let generatorCloseCalls = 0;
  let serverCloseCalls = 0;
  const generator = {
    async close() {
      generatorCloseCalls += 1;
    },
  };
  const server = {
    async connect() {},
    async close() {
      serverCloseCalls += 1;
    },
  };

  const { shutdown } = await connectWithGracefulShutdown({
    server,
    generator,
    transport: {},
    input,
    processLike,
  });
  input.emit("end");
  await shutdown();

  assert.equal(generatorCloseCalls, 1);
  assert.equal(serverCloseCalls, 1);
});

test("tool failures emit only sanitized tool and error code diagnostics", async (t) => {
  const reports = [];
  const fakeGenerator = {
    async check() {
      return { ready: true };
    },
    async generate() {
      throw new UserFacingError("sensitive local detail", "PROMPT_SUBMIT_FAILED");
    },
    async setupProject() {
      return { ok: true };
    },
    async close() {},
  };
  const { server } = createServer(
    { maxImageBytes: 1024 },
    {
      generator: fakeGenerator,
      reportToolError(tool, safe) {
        reports.push({ tool, code: safe.code });
      },
    },
  );
  const client = new Client({ name: "diagnostic-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: "generate_chatgpt_web_image",
    arguments: { prompt: "diagnostic", surface: "images" },
  });

  assert.equal(result.isError, true);
  assert.deepEqual(reports, [
    {
      tool: "generate_chatgpt_web_image",
      code: "PROMPT_SUBMIT_FAILED",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(reports), /sensitive local detail/);
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
