import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { echoCommand } from './commands/echo.js'
import { greetCommand } from './commands/greet.js'
import { helloCommand } from './commands/hello.js'

const VERSION = '0.1.0'

function formatError(message: string, args: string[]) {
  if (message.startsWith('Unknown command:')) {
    return `Error: ${message}`
  }

  if (message.startsWith('Unknown argument:')) {
    const raw = message.replace('Unknown argument:', '').trim()
    const option = raw.startsWith('-') ? raw : `--${raw}`
    return `Error: Unknown option: ${option}`
  }

  if (message.startsWith('Missing required argument:')) {
    const missing = message.replace('Missing required argument:', '').trim()
    return `Error: Missing required argument: ${missing}`
  }

  if (message.startsWith('Not enough non-option arguments')) {
    const command = args.find((arg) => !arg.startsWith('-'))
    if (command === 'greet') {
      return 'Error: Missing required argument: name'
    }

    return 'Error: Missing required argument'
  }

  return `Error: ${message}`
}

export function runCli(argv = process.argv) {
  const args = hideBin(argv)
  let handledFailure = false

  return yargs(args)
    .scriptName('agentctl')
    .version(VERSION)
    .help()
    .strict()
    .strictCommands()
    .exitProcess(false)
    .fail((msg, err) => {
      if (handledFailure) {
        return
      }

      handledFailure = true
      const message = msg || err?.message || 'Unknown error'
      console.error(formatError(message, args))
      process.exit(1)
    })
    .command(helloCommand)
    .command(greetCommand)
    .command(echoCommand)
    .command('$0', 'agentctl CLI', () => {}, () => {
      console.log('Hello from agentctl!')
    })
    .parseAsync()
}

const entry = process.argv[1]
if (!entry) {
  runCli()
} else {
  const entryUrl = pathToFileURL(realpathSync(entry)).href
  if (entryUrl === import.meta.url) {
    runCli()
  }
}
