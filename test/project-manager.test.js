import assert from "node:assert/strict";
import test from "node:test";

import { ProjectManager } from "../src/project-manager.js";
import { buildProjectInstructions, isChatGPTProjectUrl } from "../src/project-page.js";

test("recognizes only ChatGPT project home URLs", () => {
  assert.equal(isChatGPTProjectUrl("https://chatgpt.com/g/g-p-test/project"), true);
  assert.equal(isChatGPTProjectUrl("https://chatgpt.com/c/test"), false);
  assert.equal(isChatGPTProjectUrl("https://example.com/g/g-p-test/project"), false);
});

test("project instructions include configured defaults", () => {
  const instructions = buildProjectInstructions("same face", "ink wash");
  assert.match(instructions, /人物一致性/);
  assert.match(instructions, /默认人物档案：same face/);
  assert.match(instructions, /默认画风档案：ink wash/);
});

test("creates, configures, persists, and activates one fixed project", async () => {
  const calls = [];
  const config = {
    settingsFile: "/tmp/settings.json",
    projectName: "Default project",
    projectUrl: "",
    characterProfile: "",
    styleProfile: "",
    surface: "chat",
    chatgptUrl: "https://chatgpt.com/",
  };
  const session = {
    async getPage(url) {
      calls.push(["getPage", url]);
      return {};
    },
  };
  const manager = new ProjectManager(config, session, {
    createPageAdapter() {
      return {
        async create(name) {
          calls.push(["create", name]);
          return "https://chatgpt.com/g/g-p-created/project";
        },
        async configure(name, instructions) {
          calls.push(["configure", name, instructions]);
        },
      };
    },
    async persistSettings(filePath, settings) {
      calls.push(["persist", filePath, settings]);
      return settings;
    },
  });

  const result = await manager.setup({
    project_name: "Consistent images",
    character_profile: "same woman",
    style_profile: "cinematic ink painting",
  });

  assert.equal(result.created, true);
  assert.equal(result.projectUrl, "https://chatgpt.com/g/g-p-created/project");
  assert.equal(config.chatgptUrl, result.projectUrl);
  assert.equal(config.characterProfile, "same woman");
  assert.match(calls.find(([name]) => name === "configure")[2], /cinematic ink painting/);
});

test("reuses the saved project unless force_new is requested", async () => {
  let created = 0;
  const config = {
    settingsFile: "/tmp/settings.json",
    projectName: "Fixed",
    projectUrl: "https://chatgpt.com/g/g-p-fixed/project",
    characterProfile: "person",
    styleProfile: "style",
    surface: "images",
    chatgptUrl: "https://chatgpt.com/images/",
  };
  const manager = new ProjectManager(
    config,
    { async getPage() { return {}; } },
    {
      createPageAdapter() {
        return {
          async create() {
            created += 1;
            return "https://chatgpt.com/g/g-p-new/project";
          },
          async configure() {},
        };
      },
      async persistSettings(_filePath, settings) { return settings; },
    },
  );

  const reused = await manager.setup();
  assert.equal(reused.created, false);
  assert.equal(created, 0);
  assert.equal(config.chatgptUrl, "https://chatgpt.com/images/");

  const replaced = await manager.setup({ force_new: true });
  assert.equal(replaced.created, true);
  assert.equal(created, 1);
});
