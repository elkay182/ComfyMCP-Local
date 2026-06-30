export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export type Logger = {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};

export function createLogger(level: LogLevel): Logger {
  return {
    debug: (message, meta) => write("debug", level, message, meta),
    info: (message, meta) => write("info", level, message, meta),
    warn: (message, meta) => write("warn", level, message, meta),
    error: (message, meta) => write("error", level, message, meta)
  };
}

function write(level: LogLevel, configured: LogLevel, message: string, meta: unknown): void {
  if (ORDER[level] < ORDER[configured]) {
    return;
  }
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta === undefined ? {} : { meta })
  };
  process.stderr.write(`${JSON.stringify(record)}\n`);
}
