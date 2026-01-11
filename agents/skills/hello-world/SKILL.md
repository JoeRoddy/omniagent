---
name: hello-world
description: Provide minimal "Hello, world!" program examples or scaffolding for a requested language/runtime, including file name, run command, and brief explanation. Use when a user asks for a hello world example, a quick sanity-check snippet, or a minimal starter program.
---

# Hello World

## Workflow
1. Identify the target language/runtime and platform constraints.
2. If missing, ask for the target language; if the user asks for a default, pick the primary language in the current repo and say it is a default.
3. Provide the minimal runnable example:
   - File name
   - Full file contents in a code block
   - Command(s) to run
4. If a compile or build step is required, include the exact command and keep it minimal.

## Output rules
- Prefer standard library only; avoid dependencies unless explicitly requested.
- Keep the example to a single file unless the language requires more.
- Keep explanations to 1-2 sentences.
