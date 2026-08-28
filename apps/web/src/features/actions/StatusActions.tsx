import type { ReactNode } from "react";

import { useRunConsole } from "../../contexts/RunConsoleContext";
import { ApprovalAction } from "./ApprovalAction";
import { ControlActions } from "./ControlActions";
import { InputAction } from "./InputAction";

export function StatusActions(): ReactNode {
  const { run, continuation, approvals } = useRunConsole();

  if (!run) return null;

  const pendingApproval =
    run.status === "awaiting_approval"
      ? approvals.find((a) => a.status === "pending") ??
        (continuation?.approvalId
          ? approvals.find((a) => a.approvalId === continuation.approvalId)
          : undefined)
      : undefined;

  return (
    <div>
      {run.status === "awaiting_approval" && pendingApproval ? (
        <ApprovalAction run={run} approvalId={pendingApproval.approvalId} />
      ) : null}
      {run.status === "awaiting_input" && continuation?.kind === "input" ? (
        <InputAction run={run} continuation={continuation} />
      ) : null}
      <ControlActions run={run} />
    </div>
  );
}
