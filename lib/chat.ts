import "server-only";
import { createGitHubAdapter } from "@chat-adapter/github";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";

import { env } from "@/lib/env";

let instance: Chat | null = null;

export const getBot = (): Chat => {
  if (!instance) {
    instance = new Chat({
      adapters: {
        github: createGitHubAdapter({
          appId: env.GITHUB_APP_ID,
          installationId: env.GITHUB_APP_INSTALLATION_ID,
          privateKey: env.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
          userName: "openreview[bot]",
          webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
        }),
      },
      state: createMemoryState(),
      userName: "openreview",
    });
  }

  return instance;
};
