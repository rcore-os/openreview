import "server-only";
import type { GitHubRawMessage } from "@chat-adapter/github";
import type { Chat } from "chat";
import { start } from "workflow/api";

import { getBot } from "@/lib/chat";
import { getInstallationOctokit } from "@/lib/github";
import type { WorkflowParams } from "@/lib/review";

let initialized = false;

const registerHandlers = (bot: Chat): void => {
  bot.onNewMention(async (thread, message) => {
    const raw = message.raw as GitHubRawMessage;

    const repoFullName = raw.repository.full_name;
    const { prNumber } = raw;
    const comment = message.text.trim() || "Review this pull request";

    const octokit = await getInstallationOctokit();
    const [owner, repo] = repoFullName.split("/");

    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      pull_number: prNumber,
      repo,
    });

    const { botWorkflow } = await import("@/lib/review");

    await start(botWorkflow, [
      {
        baseBranch: pr.base.ref,
        comment,
        prBranch: pr.head.ref,
        prNumber,
        repoFullName,
        threadId: thread.id,
      } satisfies WorkflowParams,
    ]);
  });
};

export const initBot = (): Chat => {
  const bot = getBot();

  if (!initialized) {
    initialized = true;
    registerHandlers(bot);
  }

  return bot;
};

export const handlePullRequest = async (payload: {
  action: string;
  pull_request: {
    base: { ref: string };
    head: { ref: string };
    number: number;
  };
  repository: { full_name: string };
}): Promise<void> => {
  if (payload.action !== "opened" && payload.action !== "synchronize") {
    return;
  }

  const repoFullName = payload.repository.full_name;
  const prNumber = payload.pull_request.number;

  const { botWorkflow } = await import("@/lib/review");

  await start(botWorkflow, [
    {
      baseBranch: payload.pull_request.base.ref,
      comment: "Review this pull request",
      prBranch: payload.pull_request.head.ref,
      prNumber,
      repoFullName,
      threadId: `github:${repoFullName}:${prNumber}`,
    } satisfies WorkflowParams,
  ]);
};
