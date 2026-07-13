import { UserFacingError } from "./errors.js";

export function parseCliArgs(argv) {
  const first = argv[0] || "help";
  const command = ["--help", "-h"].includes(first) ? "help" : first;
  const result = { command, prompt: "", source_images: [], chatgpt_url: "", output_dir: "" };
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
    } else if (["--help", "-h"].includes(key)) {
      result.command = "help";
    } else {
      throw new UserFacingError(`Unknown argument: ${key}`, "INVALID_ARGUMENT");
    }
  }
  return result;
}
