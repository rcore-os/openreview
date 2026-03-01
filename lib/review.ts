import { FatalError } from "workflow";

import { parseError } from "@/lib/error";
import { addPRComment } from "@/lib/steps/add-pr-comment";
import { checkPushAccess } from "@/lib/steps/check-push-access";
import { commitAndPush } from "@/lib/steps/commit-and-push";
import { configureGit } from "@/lib/steps/configure-git";
import { createSandbox } from "@/lib/steps/create-sandbox";
import { extendSandbox } from "@/lib/steps/extend-sandbox";
import { getDiff } from "@/lib/steps/get-diff";
import { getGitHubToken } from "@/lib/steps/get-github-token";
import { hasUncommittedChanges } from "@/lib/steps/has-uncommitted-changes";
import { installDependencies } from "@/lib/steps/install-dependencies";
import { runAgent } from "@/lib/steps/run-agent";
import { stopSandbox } from "@/lib/steps/stop-sandbox";

export interface WorkflowParams {
  baseBranch: string;
  comment: string;
  prBranch: string;
  prNumber: number;
  repoFullName: string;
  threadId: string;
}

const postErrorComment = async (
  threadId: string,
  error: unknown
): Promise<void> => {
  try {
    await addPRComment(
      threadId,
      `## Error

An error occurred while processing your request:

\`\`\`
${parseError(error)}
\`\`\`

---
*Powered by [OpenReview](https://github.com/haydenbleasel/openreview)*`
    );
  } catch {
    // Ignore comment failure
  }
};

const denyPushAccess = async (
  threadId: string,
  reason: string | undefined
): Promise<never> => {
  await addPRComment(
    threadId,
    `## Skipped

Unable to access this branch: ${reason}

Please ensure the OpenReview app has access to this repository and branch.

---
*Powered by [OpenReview](https://github.com/haydenbleasel/openreview)*`
  );

  throw new FatalError(reason ?? "Push access denied");
};

const prepareSandbox = async (
  sandboxId: string,
  repoFullName: string,
  token: string
): Promise<void> => {
  await installDependencies(sandboxId);
  await configureGit(sandboxId, repoFullName, token);
  await extendSandbox(sandboxId);
};

const pushAgentChanges = async (
  sandboxId: string,
  prBranch: string
): Promise<void> => {
  const changed = await hasUncommittedChanges(sandboxId);

  if (changed) {
    await commitAndPush(sandboxId, "openreview: apply changes", prBranch);
  }
};

const runSandboxAgent = async (
  sandboxId: string,
  repoFullName: string,
  prBranch: string,
  baseBranch: string,
  token: string,
  comment: string,
  threadId: string
): Promise<void> => {
  await prepareSandbox(sandboxId, repoFullName, token);

  const diff = await getDiff(sandboxId, baseBranch);
  const agentResult = await runAgent(sandboxId, diff, comment, threadId);

  if (!agentResult.success) {
    throw new FatalError(agentResult.errorMessage ?? "Agent failed to run");
  }

  await pushAgentChanges(sandboxId, prBranch);
};

const executeWorkflow = async (params: WorkflowParams): Promise<void> => {
  const { baseBranch, comment, prBranch, repoFullName, threadId } = params;

  const token = await getGitHubToken();
  const sandboxId = await createSandbox(repoFullName, token, prBranch);

  try {
    await runSandboxAgent(
      sandboxId,
      repoFullName,
      prBranch,
      baseBranch,
      token,
      comment,
      threadId
    );
  } catch (error) {
    await postErrorComment(threadId, error);
    throw error;
  } finally {
    await stopSandbox(sandboxId);
  }
};

export const botWorkflow = async (params: WorkflowParams): Promise<void> => {
  "use workflow";

  const pushAccess = await checkPushAccess(
    params.repoFullName,
    params.prBranch
  );

  if (!pushAccess.canPush) {
    await denyPushAccess(params.threadId, pushAccess.reason);
  }

  await executeWorkflow(params);
};
