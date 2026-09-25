// Structured tool errors for the stdio PLX-MC client. Mirrors
// mcpToolErrorResult in src/lib/mcp/envelope.ts (this package runs outside the
// web app and cannot import its src/): a failed tool returns MCP isError + the
// cursor REST envelope { error: { code, message } } instead of prose, so agents
// can branch on the code (e.g. repo_not_allowlisted).

export class McRestError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} status
   */
  constructor(code, message, status) {
    super(message);
    this.name = "McRestError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Build the error for a non-2xx cursor REST response, keeping the server code.
 * @param {number} status
 * @param {unknown} json
 */
export function restErrorFromResponse(status, json) {
  const error =
    json && typeof json === "object" ? /** @type {{ error?: { code?: unknown, message?: unknown } }} */ (json).error : undefined;
  const code = typeof error?.code === "string" && error.code ? error.code : `http_${status}`;
  const message =
    typeof error?.message === "string" && error.message ? error.message : `HTTP ${status}`;
  return new McRestError(code, message, status);
}

/** @param {unknown} err */
export function toolErrorResult(err) {
  const error =
    err instanceof McRestError
      ? { code: err.code, message: err.message }
      : { code: "client_error", message: err instanceof Error ? err.message : String(err) };
  return {
    content: [{ type: "text", text: JSON.stringify({ error }, null, 2) }],
    isError: true,
  };
}

/** @param {unknown[]} args */
function withToolErrors(args) {
  const last = args.length - 1;
  const callback = args[last];
  if (typeof callback !== "function") return args;
  const wrapped = async (/** @type {unknown[]} */ ...callbackArgs) => {
    try {
      return await callback(...callbackArgs);
    } catch (err) {
      return toolErrorResult(err);
    }
  };
  return [...args.slice(0, last), wrapped];
}

/**
 * Route every tool registered afterwards (server.tool / server.registerTool)
 * through toolErrorResult. Call once, right after constructing the server.
 * @template {{ tool: Function, registerTool: Function }} T
 * @param {T} server
 * @returns {T}
 */
export function installToolErrorEnvelope(server) {
  const tool = server.tool.bind(server);
  const registerTool = server.registerTool.bind(server);
  server.tool = (/** @type {unknown[]} */ ...args) => tool(...withToolErrors(args));
  server.registerTool = (/** @type {unknown[]} */ ...args) => registerTool(...withToolErrors(args));
  return server;
}
