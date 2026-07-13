import { UserFacingError } from "./errors.js";

const LABELS = Object.freeze({
  close: ["Close", "关闭"],
  createProject: ["Create project", "创建项目"],
  instructions: ["Instructions", "指令"],
  newProject: ["New project", "新项目"],
  openSidebar: ["Open sidebar", "打开边栏"],
  projectName: ["Project name", "项目名称"],
  projectSettings: ["Project settings", "项目设置"],
  save: ["Save", "保存"],
  showProjectDetails: ["Show project details", "显示项目详情"],
});

async function firstVisibleByRole(root, role, names) {
  for (const name of names) {
    const locator = root.getByRole(role, { name, exact: true }).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

async function requireByRole(root, role, names, code) {
  const locator = await firstVisibleByRole(root, role, names);
  if (!locator) {
    throw new UserFacingError("The ChatGPT project controls are unavailable", code);
  }
  return locator;
}

export function isChatGPTProjectUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      /^\/g\/g-p-[^/]+\/project\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function buildProjectInstructions(characterProfile = "", styleProfile = "") {
  const defaults = [];
  if (characterProfile) {
    defaults.push(`默认人物档案：${characterProfile}`);
  }
  if (styleProfile) {
    defaults.push(`默认画风档案：${styleProfile}`);
  }
  return [
    "这是 ChatGPT Web Image MCP 的固定生图项目。收到生图或改图请求时：",
    "1. 把提示词中的“[人物一致性]”和“[画风一致性]”视为跨图片复用的强约束。",
    "2. 人物一致性：除非当前请求明确修改，保持同一人物的脸部结构、年龄感、发型与发色、肤色、体型比例、标志性特征和核心服装元素；有参考图时优先以参考图为准。",
    "3. 画风一致性：除非当前请求明确修改，保持媒介、线条或材质、色彩体系、光线、镜头语言、渲染方式和细节密度。",
    "4. 当前请求与一致性配置冲突时，以当前请求中明确写出的变更为准，其余特征继续保持。",
    "5. 直接执行图片生成或编辑；除非缺少关键输入，不要只返回文字方案。不要在画面中添加未要求的文字、水印或标识。",
    ...defaults,
  ].join("\n");
}

export class ChatGPTProjectPage {
  constructor(page) {
    this.page = page;
  }

  async create(projectName) {
    let newProject = await firstVisibleByRole(this.page, "button", LABELS.newProject);
    if (!newProject) {
      const openSidebar = await firstVisibleByRole(this.page, "button", LABELS.openSidebar);
      await openSidebar?.click();
      newProject = await firstVisibleByRole(this.page, "button", LABELS.newProject);
    }
    if (!newProject) {
      throw new UserFacingError(
        "Could not find the ChatGPT new-project control. Confirm that Projects is available for this account.",
        "PROJECTS_UNAVAILABLE",
      );
    }
    await newProject.click();
    const dialog = this.page.getByRole("dialog").last();
    await dialog.waitFor({ state: "visible", timeout: 15000 });
    const nameInput = await requireByRole(dialog, "textbox", LABELS.projectName, "PROJECT_CREATE_FAILED");
    await nameInput.fill(projectName);
    const createButton = await requireByRole(
      dialog,
      "button",
      LABELS.createProject,
      "PROJECT_CREATE_FAILED",
    );
    await createButton.click();
    try {
      await this.page.waitForURL((url) => isChatGPTProjectUrl(url.href), { timeout: 30000 });
    } catch (error) {
      throw new UserFacingError("ChatGPT did not finish creating the project", "PROJECT_CREATE_FAILED", {
        cause: error,
      });
    }
    return this.page.url();
  }

  async configure(projectName, instructions) {
    const details = await requireByRole(
      this.page,
      "button",
      LABELS.showProjectDetails,
      "PROJECT_SETTINGS_UNAVAILABLE",
    );
    await details.click();
    const settingsItem = await requireByRole(
      this.page,
      "menuitem",
      LABELS.projectSettings,
      "PROJECT_SETTINGS_UNAVAILABLE",
    );
    await settingsItem.click();
    const dialog = this.page.getByRole("dialog").last();
    await dialog.waitFor({ state: "visible", timeout: 15000 });
    const nameInput = await requireByRole(dialog, "textbox", LABELS.projectName, "PROJECT_SETTINGS_FAILED");
    const instructionsInput = await requireByRole(
      dialog,
      "textbox",
      LABELS.instructions,
      "PROJECT_SETTINGS_FAILED",
    );
    await nameInput.fill(projectName);
    await instructionsInput.fill(instructions);
    const save = await requireByRole(dialog, "button", LABELS.save, "PROJECT_SETTINGS_FAILED");
    await save.click();
    await this.page.waitForTimeout(600);
    const close = await firstVisibleByRole(dialog, "button", LABELS.close);
    await close?.click();
  }
}
