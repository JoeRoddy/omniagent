import type { CommandModule } from 'yargs'

type GreetArgs = {
  name: string
  uppercase: boolean
}

export const greetCommand: CommandModule<{}, GreetArgs> = {
  command: 'greet <name>',
  describe: 'Greet someone by name',
  builder: (yargs) =>
    yargs
      .positional('name', {
        type: 'string',
        describe: 'Name to greet'
      })
      .option('uppercase', {
        alias: 'u',
        type: 'boolean',
        default: false,
        describe: 'Output in uppercase'
      }),
  handler: (argv) => {
    const greeting = `Hello, ${argv.name}!`
    if (argv.uppercase) {
      console.log(greeting.toUpperCase())
      return
    }

    console.log(greeting)
  }
}
