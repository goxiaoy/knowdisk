const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

export function sanitizePythonWorkerStderrLine(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, "");
}
