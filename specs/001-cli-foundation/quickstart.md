# Quickstart: CLI Foundation

## Prerequisites

- Node.js 18+
- npm or pnpm

## Setup

```bash
# Install dependencies
npm install

# Build the CLI
npm run build

# Run locally (without installing)
node dist/cli.js

# Or link for global access during development
npm link
omniagent
```

## Expected Output

```
Hello from omniagent!
```

## Verify Installation

```bash
# Check version
omniagent --version

# Check help
omniagent --help
```

## Development

```bash
# Run in development mode (if configured)
npm run dev

# Run tests
npm test
```

## Troubleshooting

**"command not found: omniagent"**
- Run `npm link` to create global symlink
- Or run directly: `node dist/cli.js`

**Build fails**
- Ensure Node.js 18+ is installed
- Run `npm install` to install dependencies
- Check `vite.config.ts` exists and is valid
