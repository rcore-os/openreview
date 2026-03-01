import { Sandbox } from "@vercel/sandbox";

import { createAgent } from "@/lib/agent";
import { parseError } from "@/lib/error";
import type { ThreadMessage } from "@/workflow";

export interface AgentResult {
  errorMessage?: string;
  success: boolean;
}

export const runAgent = async (
  sandboxId: string,
  diff: string,
  threadMessages: ThreadMessage[],
  threadId: string
): Promise<AgentResult> => {
  "use step";

  const sandbox = await Sandbox.get({ sandboxId }).catch((error: unknown) => {
    throw new Error(`[runAgent] Failed to get sandbox: ${parseError(error)}`, {
      cause: error,
    });
  });

  try {
    const agent = await createAgent(sandbox, threadId, diff);

    await agent.generate({
      messages: threadMessages.map((msg) => ({
        content: msg.content,
        role: msg.role,
      })),
    });

    return { success: true };
  } catch (error) {
    return {
      errorMessage: parseError(error),
      success: false,
    };
  }
};
