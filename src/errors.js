export class UserFacingError extends Error {
  constructor(message, code = "AUTOMATION_ERROR", options = {}) {
    super(message, options);
    this.name = "UserFacingError";
    this.code = code;
  }
}

export function safeError(error) {
  if (error instanceof UserFacingError) {
    return { code: error.code, message: error.message };
  }

  const message = String(error?.message || "");
  if (message.includes("Executable doesn't exist") || message.includes("Failed to launch")) {
    return {
      code: "CHROME_NOT_FOUND",
      message: "Google Chrome could not be started. Install Chrome or configure CHATGPT_CDP_URL.",
    };
  }
  if (message.includes("connect ECONNREFUSED") || message.includes("ECONNREFUSED")) {
    return {
      code: "CDP_UNREACHABLE",
      message: "The configured Chrome debugging endpoint is not reachable.",
    };
  }
  return {
    code: "AUTOMATION_ERROR",
    message: "ChatGPT browser automation failed. Run the CLI check command for local diagnostics.",
  };
}
