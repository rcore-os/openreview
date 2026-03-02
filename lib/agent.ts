import { Sandbox } from "@vercel/sandbox";
import { DurableAgent } from "@workflow/ai/agent";
import { tool } from "ai";
import { z } from "zod";

import { addPRComment } from "@/workflow/steps/add-pr-comment";

const instructions = `You are an expert software engineering assistant working inside a sandbox with a git repository checked out on a PR branch.

You have the following tools:

- **bash / readFile / writeFile** — run commands, read and write files inside the sandbox
- **reply** — post a top-level comment on the pull request

The \`gh\` CLI is authenticated and available in bash. The current PR is **#{{PR_NUMBER}}** in **{{REPO}}**.

Based on the user's request, decide what to do. Your capabilities include:

## Code Review
- Review the PR diff for bugs, security vulnerabilities, performance issues, code quality, missing error handling, and race conditions
- Use \`gh\` CLI for GitHub interactions:
  - \`gh pr diff {{PR_NUMBER}}\` — view the full diff
  - \`gh pr view {{PR_NUMBER}} --json files\` — list changed files
  - \`gh pr review {{PR_NUMBER}} --approve --body "..."\` — approve the PR
  - \`gh pr review {{PR_NUMBER}} --request-changes --body "..."\` — request changes
  - \`gh pr review {{PR_NUMBER}} --comment --body "..."\` — leave a review comment
  - \`gh api repos/{{REPO}}/pulls/{{PR_NUMBER}}/comments -f body="..." -f path="..." -f line=N -f commit_id="$(gh pr view {{PR_NUMBER}} --json headRefOid -q .headRefOid)"\` — inline comment on a specific line
- To suggest a code fix in an inline comment, use GitHub suggestion syntax:
  \`\`\`suggestion
  corrected code here
  \`\`\`
- Be specific and reference file paths and line numbers
- For each issue, explain what the problem is, why it matters, and how to fix it
- Don't nitpick style or formatting

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

## Replying
- Use the reply tool to post your response to the pull request
- Always reply at least once with your findings or actions taken
- Format replies as markdown
- Be concise and actionable
- End every reply with a line break, a horizontal rule, then: *Powered by [OpenReview](https://github.com/haydenbleasel/openreview)*

## PR Diff for Reference

\`\`\`diff
{{DIFF}}
\`\`\``;

const SANDBOX_CWD = "./workspace";

const createBashTool = (sandboxId: string) =>
  tool({
    description: [
      "Execute bash commands in the sandbox environment.",
      "",
      `WORKING DIRECTORY: ${SANDBOX_CWD}`,
      "All commands execute from this directory. Use relative paths from here.",
      "",
      "Common operations:",
      "  ls -la              # List files with details",
      "  find . -name '*.ts' # Find files by pattern",
      "  grep -r 'pattern' . # Search file contents",
      "  cat <file>          # View file contents",
    ].join("\n"),
    execute: async ({ command }) => {
      "use step";

      const sandbox = await Sandbox.get({ sandboxId });
      const fullCommand = `cd "${SANDBOX_CWD}" && ${command}`;
      const result = await sandbox.runCommand("bash", ["-c", fullCommand]);
      const [stdout, stderr] = await Promise.all([
        result.stdout(),
        result.stderr(),
      ]);

      return { exitCode: result.exitCode, stderr, stdout };
    },
    inputSchema: z.object({
      command: z.string().describe("The bash command to execute"),
    }),
  });

const createReadFileTool = (sandboxId: string) =>
  tool({
    description: "Read the contents of a file from the sandbox.",
    execute: async ({ path }) => {
      "use step";

      const sandbox = await Sandbox.get({ sandboxId });
      const resolvedPath = path.startsWith("/")
        ? path
        : `${SANDBOX_CWD}/${path}`;

      const buffer = await sandbox.readFileToBuffer({ path: resolvedPath });

      if (buffer === null) {
        throw new Error(`File not found: ${resolvedPath}`);
      }

      const content = buffer.toString("utf8");

      return { content };
    },
    inputSchema: z.object({
      path: z.string().describe("The path to the file to read"),
    }),
  });

const createWriteFileTool = (sandboxId: string) =>
  tool({
    description:
      "Write content to a file in the sandbox. Creates parent directories if needed.",
    execute: async ({ content, path }) => {
      "use step";

      const sandbox = await Sandbox.get({ sandboxId });
      const resolvedPath = path.startsWith("/")
        ? path
        : `${SANDBOX_CWD}/${path}`;

      await sandbox.writeFiles([
        { content: Buffer.from(content), path: resolvedPath },
      ]);

      return { success: true };
    },
    inputSchema: z.object({
      content: z.string().describe("The content to write to the file"),
      path: z.string().describe("The path where the file should be written"),
    }),
  });

const createReplyTool = (threadId: string) =>
  tool({
    description:
      "Post a comment on the pull request. Use this to share your findings, ask questions, or report results.",
    execute: async ({ body }) => {
      "use step";

      await addPRComment(threadId, body);
      return { success: true };
    },
    inputSchema: z.object({
      body: z.string().describe("The markdown-formatted comment body to post"),
    }),
  });

export const createAgent = (
  sandboxId: string,
  threadId: string,
  diff: string,
  prNumber: number,
  repoFullName: string
) =>
  new DurableAgent({
    model: "anthropic/claude-sonnet-4.6",
    system: instructions
      .replaceAll("{{PR_NUMBER}}", String(prNumber))
      .replaceAll("{{REPO}}", repoFullName)
      .replace("{{DIFF}}", diff),
    tools: {
      bash: createBashTool(sandboxId),
      readFile: createReadFileTool(sandboxId),
      reply: createReplyTool(threadId),
      writeFile: createWriteFileTool(sandboxId),
    },
  });
