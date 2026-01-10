import type { CommandModule } from 'yargs'

export const helloCommand: CommandModule = {
  command: 'hello',
  describe: 'Print a greeting',
  handler: () => {
    console.log('Hello, World!')
  }
}
