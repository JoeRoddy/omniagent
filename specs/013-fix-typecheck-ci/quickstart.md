# Quickstart: Typecheck and CI Reliability

## Prerequisites

- Node.js 18+
- npm

## Local validation (matches CI steps)

1. Install dependencies:
   - `npm ci`
2. Run quality check:
   - `npm run check`
3. Run typecheck:
   - `npm run typecheck`
4. Run tests:
   - `npm test`
5. Run build:
   - `npm run build`

## Expected outcomes

- Each step completes successfully with exit code 0 on the default branch.
- Any step failure should stop the sequence and report the failing step.
