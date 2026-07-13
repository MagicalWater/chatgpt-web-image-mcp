import { normalizeProfile } from "./consistency-profiles.js";
import { validateChatGPTProjectUrl } from "./config.js";
import { UserFacingError } from "./errors.js";
import { writeLocalSettings } from "./local-settings.js";
import { buildProjectInstructions, ChatGPTProjectPage } from "./project-page.js";

const DEFAULT_PROJECT_NAME = "ChatGPT Web Image MCP";

function normalizeProjectName(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new UserFacingError("project_name must be a non-empty string", "INVALID_PROJECT_NAME");
  }
  const name = value.trim();
  if (name.length > 80) {
    throw new UserFacingError("project_name must not exceed 80 characters", "INVALID_PROJECT_NAME");
  }
  return name;
}

export class ProjectManager {
  constructor(config, session, dependencies = {}) {
    this.config = config;
    this.session = session;
    this.createPageAdapter =
      dependencies.createPageAdapter || ((page) => new ChatGPTProjectPage(page));
    this.persistSettings = dependencies.persistSettings || writeLocalSettings;
  }

  async setup(input = {}) {
    if (input.force_new && input.project_url) {
      throw new UserFacingError(
        "force_new cannot be combined with project_url",
        "INVALID_PROJECT_SETUP",
      );
    }
    const projectName = normalizeProjectName(
      input.project_name || this.config.projectName || DEFAULT_PROJECT_NAME,
    );
    const characterProfile = Object.hasOwn(input, "character_profile")
      ? normalizeProfile(input.character_profile, "character_profile")
      : this.config.characterProfile;
    const styleProfile = Object.hasOwn(input, "style_profile")
      ? normalizeProfile(input.style_profile, "style_profile")
      : this.config.styleProfile;
    let projectUrl = input.project_url
      ? validateChatGPTProjectUrl(input.project_url)
      : input.force_new
        ? ""
        : this.config.projectUrl;
    const page = await this.session.getPage(projectUrl || "https://chatgpt.com/");
    const adapter = this.createPageAdapter(page);
    const created = !projectUrl;
    if (created) {
      projectUrl = validateChatGPTProjectUrl(await adapter.create(projectName));
    }
    await adapter.configure(
      projectName,
      buildProjectInstructions(characterProfile, styleProfile),
    );

    const settings = await this.persistSettings(this.config.settingsFile, {
      project_url: projectUrl,
      project_name: projectName,
      character_profile: characterProfile,
      style_profile: styleProfile,
    });
    this.config.localSettings = settings;
    this.config.projectUrl = projectUrl;
    this.config.projectName = projectName;
    this.config.characterProfile = characterProfile;
    this.config.styleProfile = styleProfile;
    if (this.config.surface === "chat") {
      this.config.chatgptUrl = projectUrl;
    }

    return {
      ok: true,
      created,
      projectName,
      projectUrl,
      characterProfileConfigured: Boolean(characterProfile),
      styleProfileConfigured: Boolean(styleProfile),
    };
  }
}
