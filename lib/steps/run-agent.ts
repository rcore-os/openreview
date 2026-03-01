import { anthropic } from "@ai-sdk/anthropic";
import { Sandbox } from "@vercel/sandbox";
import { generateText, stepCountIs } from "ai";
import { createBashTool } from "bash-tool";

import { parseError } from "@/lib/error";

export interface AgentResult {
  errorMessage?: string;
  success: boolean;
  text: string;
}

const systemPrompt = `You are an expert software engineering assistant working inside a sandbox with a git repository checked out on a PR branch.

You have access to bash, readFile, and writeFile tools. Use them to explore the codebase, run commands, and make changes as needed.

Based on the user's request, decide what to do. Your capabilities include:

## Code Review
- Review the PR diff for bugs, security vulnerabilities, performance issues, code quality, missing error handling, and race conditions
- Be specific and reference file paths and line numbers
- For each issue, explain what the problem is, why it matters, and how to fix it
- If the code looks good, say so briefly — don't nitpick style or formatting

## Linting & Formatting
- Run the project's linter and/or formatter when asked
- Check package.json scripts for lint/format commands (e.g. "check", "fix", "lint", "format")
- If no project-specific commands exist, fall back to \`npx ultracite check\` or \`npx ultracite fix\`
- Report any issues found, or confirm the code is clean

## Codebase Exploration
- Answer questions about the codebase structure, dependencies, or implementation details
- Use bash commands like find, grep, cat to explore

## Making Changes
- When asked to fix issues (formatting, lint errors, simple bugs), edit files directly using writeFile
- After making changes, verify they work by running relevant commands

Always format your response as markdown. Be concise and actionable.`;

const callAgent = async (
  sandbox: Sandbox,
  diff: string,
  comment: string
): Promise<string> => {
  const { tools } = await createBashTool({ sandbox });

  const { text } = await generateText({
    model: anthropic("claude-haiku-4-5"),
    prompt: `User request: ${comment}\n\nHere is the PR diff:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nHandle the user's request. Use the tools to explore files, run commands, or make changes as needed.`,
    stopWhen: stepCountIs(20),
    system: systemPrompt,
    tools,
  });

  return text;
};

export const runAgent = async (
  sandboxId: string,
  diff: string,
  comment: string
): Promise<AgentResult> => {
  "use step";

  const sandbox = await Sandbox.get({ sandboxId }).catch((error: unknown) => {
    throw new Error(`[runAgent] Failed to get sandbox: ${parseError(error)}`, {
      cause: error,
    });
  });

  try {
    const text = await callAgent(sandbox, diff, comment);
    return { success: true, text };
  } catch (error) {
    return {
      errorMessage: parseError(error),
      success: false,
      text: "",
    };
  }
};
