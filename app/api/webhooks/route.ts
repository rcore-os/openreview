import { after, NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { handlePullRequest, initBot } from "@/lib/bot";
import { getGitHubApp } from "@/lib/github";

const handlePullRequestEvent = async (
  request: NextRequest
): Promise<NextResponse> => {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";

  const app = getGitHubApp();
  await app.webhooks.verify(rawBody, signature);

  const payload = JSON.parse(rawBody) as Parameters<
    typeof handlePullRequest
  >[0];

  after(async () => {
    await handlePullRequest(payload);
  });

  return NextResponse.json({ ok: true });
};

const handleChatEvent = (request: NextRequest): Promise<NextResponse> => {
  const bot = initBot();
  const handler = bot.webhooks.github;

  if (!handler) {
    return Promise.resolve(
      NextResponse.json(
        { error: "GitHub adapter not configured" },
        { status: 404 }
      )
    );
  }

  return handler(request, {
    waitUntil: (task) => after(() => task),
  }) as Promise<NextResponse>;
};

export const POST = (request: NextRequest): Promise<NextResponse> => {
  const event = request.headers.get("x-github-event");

  if (event === "pull_request") {
    return handlePullRequestEvent(request);
  }

  return handleChatEvent(request);
};
