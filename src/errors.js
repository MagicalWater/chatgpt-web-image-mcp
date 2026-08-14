export class UserFacingError extends Error {
  constructor(message, code = "AUTOMATION_ERROR", options = {}) {
    super(message, options);
    this.name = "UserFacingError";
    this.code = code;
    if (typeof options.assistantReply === "string" && options.assistantReply.trim()) {
      this.assistantReply = options.assistantReply
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 4000);
    }
  }
}

export function safeError(error) {
  if (error instanceof UserFacingError) {
    const safe = { code: error.code, message: error.message };
    if (error.assistantReply) {
      safe.assistant_reply = error.assistantReply;
    }
    return safe;
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
