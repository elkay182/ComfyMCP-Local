export type ApprovalCommandResult = {
  exitCode: number;
  stdout?: unknown;
  stderr?: string;
};

export function runApproveCommand(args: string[]): ApprovalCommandResult {
  const [planId] = args;
  if (!planId) {
    return {
      exitCode: 2,
      stderr: "usage: comfymcp-local approve <plan_id>"
    };
  }
  return {
    exitCode: 1,
    stderr: "approval store is not implemented in the Milestone 0 scaffold"
  };
}
