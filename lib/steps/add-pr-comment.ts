import { getBot } from "@/lib/chat";

export const addPRComment = async (
  threadId: string,
  body: string
): Promise<void> => {
  "use step";

  const adapter = getBot().getAdapter("github");
  await adapter.postMessage(threadId, { markdown: body });
};
