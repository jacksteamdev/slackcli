import { Command } from 'commander';
import ora from 'ora';
import { getAuthenticatedClient } from '../lib/auth.ts';
import { formatSearchResults, error } from '../lib/formatter.ts';
import type { SlackUser } from '../types/index.ts';

export function createSearchCommand(): Command {
  const search = new Command('search')
    .description('Search messages across your workspace');

  search
    .command('messages')
    .description('Search for messages')
    .requiredOption('--query <text>', 'Search query')
    .option('--count <number>', 'Number of results to return (default: 20, max: 100)', '20')
    .option('--sort <type>', 'Sort by timestamp or score (default: score)', 'score')
    .option('--channel <id>', 'Filter by channel ID')
    .option('--workspace <id|name>', 'Workspace to use')
    .action(async (options) => {
      const spinner = ora('Searching messages...').start();

      try {
        const client = await getAuthenticatedClient(options.workspace);

        // Validate count
        const count = parseInt(options.count, 10);
        if (isNaN(count) || count < 1 || count > 100) {
          spinner.fail('Invalid count parameter');
          error('Count must be between 1 and 100');
          process.exit(1);
        }

        // Validate sort
        if (options.sort && !['timestamp', 'score'].includes(options.sort)) {
          spinner.fail('Invalid sort parameter');
          error('Sort must be either "timestamp" or "score"');
          process.exit(1);
        }

        // Perform search
        const searchResults = await client.searchMessages(options.query, {
          count,
          sort: options.sort,
          channel: options.channel,
        });

        if (!searchResults.ok) {
          spinner.fail('Search failed');
          error(searchResults.error || 'Unknown error occurred');
          process.exit(1);
        }

        // Collect unique user IDs from search results
        const userIds = new Set<string>();
        const matches = searchResults.messages?.matches || [];
        matches.forEach((match: any) => {
          if (match.user) {
            userIds.add(match.user);
          }
        });

        // Fetch user info
        let users = new Map<string, SlackUser>();
        if (userIds.size > 0) {
          const userResponse = await client.getUsersInfo(Array.from(userIds));
          if (userResponse.ok && userResponse.users) {
            users = new Map(
              userResponse.users.map((u: SlackUser) => [u.id, u])
            );
          }
        }

        spinner.succeed(`Found ${searchResults.messages?.total || 0} results`);

        // Format and display results
        const output = formatSearchResults(searchResults, users);
        console.log('\n' + output);

      } catch (err: any) {
        spinner.fail('Search failed');
        error(err.message);
        process.exit(1);
      }
    });

  return search;
}
