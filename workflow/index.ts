import { FatalError } from "workflow";

import { parseError } from "@/lib/error";

import { addPRComment } from "./steps/add-pr-comment";
import { checkPushAccess } from "./steps/check-push-access";
import { commitAndPush } from "./steps/commit-and-push";
import { configureGit } from "./steps/configure-git";
import { createSandbox } from "./steps/create-sandbox";
import { extendSandbox } from "./steps/extend-sandbox";
import { getGitHubToken } from "./steps/get-github-token";
import { hasUncommittedChanges } from "./steps/has-uncommitted-changes";
import { installDependencies } from "./steps/install-dependencies";
import { runAgent } from "./steps/run-agent";
import { stopSandbox } from "./steps/stop-sandbox";

export interface ThreadMessage {
  content: string;
  role: "assistant" | "user";
}

export interface WorkflowParams {
  baseBranch: string;
  messages: ThreadMessage[];
  prBranch: string;
  prNumber: number;
  repoFullName: string;
  threadId: string;
}

export const botWorkflow = async (params: WorkflowParams): Promise<void> => {
  "use workflow";

  const {
    baseBranch: _baseBranch,
    messages,
    prBranch,
    prNumber,
    repoFullName,
    threadId,
  } = params;

  const pushAccess = await checkPushAccess(repoFullName, prBranch);

  if (!pushAccess.canPush) {
    await addPRComment(
      threadId,
      `## Skipped

Unable to access this branch: ${pushAccess.reason}

Please ensure the OpenReview app has access to this repository and branch.

---
*Powered by [OpenReview](https://github.com/vercel-labs/openreview)*`
    );

    throw new FatalError(pushAccess.reason ?? "Push access denied");
  }

  const token = await getGitHubToken();
  const sandboxId = await createSandbox(repoFullName, token, prNumber);

  try {
    await installDependencies(sandboxId);
    await configureGit(sandboxId, repoFullName, token);
    await extendSandbox(sandboxId);

    const agentResult = await runAgent(
      sandboxId,
      messages,
      threadId,
      prNumber,
      repoFullName
    );

    if (!agentResult.success) {
      throw new FatalError(agentResult.errorMessage ?? "Agent failed to run");
    }

    const changed = await hasUncommittedChanges(sandboxId);

    if (changed) {
      await commitAndPush(sandboxId, "openreview: apply changes", prBranch);
    }
  } catch (error) {
    try {
      await addPRComment(
        threadId,
        `## Error

An error occurred while processing your request:

\`\`\`
${parseError(error)}
\`\`\`

---
*Powered by [OpenReview](https://github.com/vercel-labs/openreview)*`
      );
    } catch {
      // Ignore comment failure
    }

    throw error;
  } finally {
    await stopSandbox(sandboxId);
  }
};
