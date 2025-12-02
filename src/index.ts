#!/usr/bin/env bun

import { Command } from 'commander';
import { createAuthCommand } from './commands/auth.ts';
import { createConversationsCommand } from './commands/conversations.ts';
import chalk from 'chalk';

const program = new Command();

program
  .name('slackcli')
  .description('A fast, developer-friendly CLI tool for interacting with Slack workspaces (read-only)')
  .version('0.1.1');

// Add commands
program.addCommand(createAuthCommand());
program.addCommand(createConversationsCommand());

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

