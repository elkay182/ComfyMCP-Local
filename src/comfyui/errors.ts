export class ComfyUiError extends Error {
  readonly status?: number;
  readonly code: "COMFY_UNAVAILABLE" | "COMFY_HTTP_ERROR" | "COMFY_INVALID_RESPONSE";

  constructor(
    code: "COMFY_UNAVAILABLE" | "COMFY_HTTP_ERROR" | "COMFY_INVALID_RESPONSE",
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "ComfyUiError";
    this.code = code;
    this.status = status;
  }
}
