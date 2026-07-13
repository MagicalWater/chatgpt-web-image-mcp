import { UserFacingError } from "./errors.js";

export function parseCliArgs(argv) {
  const first = argv[0] || "help";
  const command = ["--help", "-h"].includes(first) ? "help" : first;
  const result = {
    command,
    prompt: "",
    source_images: [],
    chatgpt_url: "",
    character_profile: undefined,
    force_new: false,
    output_dir: "",
    project_name: "",
    project_url: "",
    style_profile: undefined,
    surface: "",
    use_consistency: undefined,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (["--prompt", "-p"].includes(key)) {
      result.prompt = value || "";
      index += 1;
    } else if (["--source", "-s"].includes(key)) {
      if (!value) {
        throw new UserFacingError(`${key} requires a path`, "INVALID_ARGUMENT");
      }
      result.source_images.push(value);
      index += 1;
    } else if (key === "--chatgpt-url") {
      result.chatgpt_url = value || "";
      index += 1;
    } else if (key === "--output-dir") {
      result.output_dir = value || "";
      index += 1;
    } else if (key === "--surface") {
      if (!value) {
        throw new UserFacingError("--surface requires chat or images", "INVALID_ARGUMENT");
      }
      result.surface = value;
      index += 1;
    } else if (key === "--character") {
      if (value === undefined) {
        throw new UserFacingError("--character requires a profile", "INVALID_ARGUMENT");
      }
      result.character_profile = value;
      index += 1;
    } else if (key === "--style") {
      if (value === undefined) {
        throw new UserFacingError("--style requires a profile", "INVALID_ARGUMENT");
      }
      result.style_profile = value;
      index += 1;
    } else if (key === "--no-consistency") {
      result.use_consistency = false;
    } else if (key === "--project-name") {
      if (!value) {
        throw new UserFacingError("--project-name requires a name", "INVALID_ARGUMENT");
      }
      result.project_name = value;
      index += 1;
    } else if (key === "--project-url") {
      if (!value) {
        throw new UserFacingError("--project-url requires a URL", "INVALID_ARGUMENT");
      }
      result.project_url = value;
      index += 1;
    } else if (key === "--force-new") {
      result.force_new = true;
    } else if (["--help", "-h"].includes(key)) {
      result.command = "help";
    } else {
      throw new UserFacingError(`Unknown argument: ${key}`, "INVALID_ARGUMENT");
    }
  }
  return result;
}
