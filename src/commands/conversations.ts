import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { getAuthenticatedClient } from '../lib/auth.ts';
import { getWorkspace } from '../lib/workspaces.ts';
import { error, formatChannelList, formatConversationHistory } from '../lib/formatter.ts';
import type { SlackChannel, SlackMessage, SlackUser } from '../types/index.ts';

// Parse user-friendly date string to UNIX timestamp (seconds)
function parseDate(dateStr: string): string {
  // Handle relative dates: "X days/weeks/hours ago"
  const relativeMatch = dateStr.match(/^(\d+)\s+(day|days|week|weeks|hour|hours)\s+ago$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const now = Date.now();
    let ms = 0;

    if (unit.startsWith('hour')) {
      ms = amount * 60 * 60 * 1000;
    } else if (unit.startsWith('day')) {
      ms = amount * 24 * 60 * 60 * 1000;
    } else if (unit.startsWith('week')) {
      ms = amount * 7 * 24 * 60 * 60 * 1000;
    }

    return Math.floor((now - ms) / 1000).toString();
  }

  // Handle absolute dates: "YYYY-MM-DD" or "MMM DD"
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: "${dateStr}". Use formats like "2 days ago", "1 week ago", or "2025-11-25"`);
  }

  return Math.floor(date.getTime() / 1000).toString();
}

export function createConversationsCommand(): Command {
  const conversations = new Command('conversations')
    .description('Manage Slack conversations (channels, DMs, groups)');

  // List conversations
  conversations
    .command('list')
    .description('List all conversations')
    .option('--types <types>', 'Conversation types (comma-separated: public_channel,private_channel,mpim,im)', 'public_channel,private_channel,mpim,im')
    .option('--limit <number>', 'Number of conversations to return', '100')
    .option('--exclude-archived', 'Exclude archived conversations', false)
    .option('--unread-only', 'Only show conversations with unread messages', false)
    .option('--show-unreads', 'Show unread count badges for all conversations', false)
    .option('--cursor <string>', 'Pagination cursor for next page of results')
    .option('--workspace <id|name>', 'Workspace to use (overrides default)')
    .action(async (options) => {
      const spinner = ora('Fetching conversations...').start();

      try {
        const client = await getAuthenticatedClient(options.workspace);

        const response = await client.listConversations({
          types: options.types,
          limit: parseInt(options.limit),
          exclude_archived: options.excludeArchived,
          cursor: options.cursor,
        });

        let channels: SlackChannel[] = response.channels || [];

        // Fetch unread counts if needed
        if (options.unreadOnly || options.showUnreads) {
          spinner.text = 'Fetching unread counts...';

          if (options.unreadOnly) {
            // Filter to only channels with unreads
            const channelsWithUnreads: SlackChannel[] = [];

            for (const channel of channels) {
              try {
                const infoResponse = await client.getConversationInfo(channel.id);
                if (infoResponse.ok && infoResponse.channel) {
                  const channelInfo = infoResponse.channel;
                  if (channelInfo.unread_count_display && channelInfo.unread_count_display > 0) {
                    channel.unread_count_display = channelInfo.unread_count_display;
                    channel.last_read = channelInfo.last_read;
                    channelsWithUnreads.push(channel);
                  }
                }
              } catch (err) {
                // Skip channels we can't fetch info for
              }
            }

            channels = channelsWithUnreads;
          } else {
            // Show all channels but populate unread counts
            for (const channel of channels) {
              try {
                const infoResponse = await client.getConversationInfo(channel.id);
                if (infoResponse.ok && infoResponse.channel) {
                  const channelInfo = infoResponse.channel;
                  channel.unread_count_display = channelInfo.unread_count_display;
                  channel.last_read = channelInfo.last_read;
                }
              } catch (err) {
                // Skip channels we can't fetch info for
              }
            }
          }
        }

        // Fetch user info for DMs
        const userIds = new Set<string>();
        channels.forEach(ch => {
          if (ch.is_im && ch.user) {
            userIds.add(ch.user);
          }
        });

        const users = new Map<string, SlackUser>();
        if (userIds.size > 0) {
          spinner.text = 'Fetching user information...';
          const usersResponse = await client.getUsersInfo(Array.from(userIds));
          usersResponse.users?.forEach((user: SlackUser) => {
            users.set(user.id, user);
          });
        }

        spinner.succeed(`Found ${channels.length} conversations`);

        console.log('\n' + formatChannelList(channels, users));

        // Show pagination hint if there are more results
        if (response.response_metadata?.next_cursor) {
          console.log('\n' + chalk.dim('To see more results:'));
          console.log(chalk.cyan(`  slack conversations list --cursor=${response.response_metadata.next_cursor}${options.limit ? ` --limit=${options.limit}` : ''}${options.types ? ` --types=${options.types}` : ''}`));
        }
      } catch (err: any) {
        spinner.fail('Failed to fetch conversations');
        error(err.message, 'Run "slackcli auth list" to check your authentication.');
        process.exit(1);
      }
    });

  // List unread conversations
  conversations
    .command('unread')
    .description('List conversations with unread messages')
    .option('--types <types>', 'Conversation types (comma-separated: public_channel,private_channel,mpim,im)', 'public_channel,private_channel,mpim,im')
    .option('--limit <number>', 'Number of conversations to return', '100')
    .option('--workspace <id|name>', 'Workspace to use (overrides default)')
    .action(async (options) => {
      const spinner = ora('Fetching conversations with unreads...').start();

      try {
        const client = await getAuthenticatedClient(options.workspace);

        const response = await client.listConversations({
          types: options.types,
          limit: parseInt(options.limit),
          exclude_archived: true,
        });

        const allChannels: SlackChannel[] = response.channels || [];
        const channelsWithUnreads: SlackChannel[] = [];

        spinner.text = 'Checking for unread messages...';

        for (const channel of allChannels) {
          try {
            const infoResponse = await client.getConversationInfo(channel.id);
            if (infoResponse.ok && infoResponse.channel) {
              const channelInfo = infoResponse.channel;
              if (channelInfo.unread_count_display && channelInfo.unread_count_display > 0) {
                channel.unread_count_display = channelInfo.unread_count_display;
                channel.last_read = channelInfo.last_read;
                channelsWithUnreads.push(channel);
              }
            }
          } catch (err) {
            // Skip channels we can't fetch info for
          }
        }

        // Fetch user info for DMs
        const userIds = new Set<string>();
        channelsWithUnreads.forEach(ch => {
          if (ch.is_im && ch.user) {
            userIds.add(ch.user);
          }
        });

        const users = new Map<string, SlackUser>();
        if (userIds.size > 0) {
          spinner.text = 'Fetching user information...';
          const usersResponse = await client.getUsersInfo(Array.from(userIds));
          usersResponse.users?.forEach((user: SlackUser) => {
            users.set(user.id, user);
          });
        }

        spinner.succeed(`Found ${channelsWithUnreads.length} conversations with unread messages`);

        console.log('\n' + formatChannelList(channelsWithUnreads, users));
      } catch (err: any) {
        spinner.fail('Failed to fetch conversations');
        error(err.message, 'Run "slackcli auth list" to check your authentication.');
        process.exit(1);
      }
    });

  // Read conversation history
  conversations
    .command('read')
    .description('Read conversation history or specific thread')
    .argument('<channel-id>', 'Channel ID to read from')
    .option('--thread-ts <timestamp>', 'Thread timestamp to read specific thread')
    .option('--exclude-replies', 'Exclude threaded replies (only top-level messages)', false)
    .option('--limit <number>', 'Number of messages to return', '100')
    .option('--oldest <timestamp>', 'Start of time range')
    .option('--latest <timestamp>', 'End of time range')
    .option('--since <date>', 'Start date (e.g., "2 days ago", "1 week ago", "2025-11-25")')
    .option('--until <date>', 'End date (e.g., "1 day ago", "2025-11-30")')
    .option('--cursor <string>', 'Pagination cursor for next page of results')
    .option('--workspace <id|name>', 'Workspace to use')
    .option('--json', 'Output in JSON format (includes timestamps for replies)', false)
    .action(async (channelId, options) => {
      const spinner = ora('Fetching messages...').start();

      try {
        const client = await getAuthenticatedClient(options.workspace);

        // Parse date filters if provided
        let oldest = options.oldest;
        let latest = options.latest;

        if (options.since) {
          oldest = parseDate(options.since);
        }

        if (options.until) {
          latest = parseDate(options.until);
        }

        let response: any;
        let messages: SlackMessage[];

        if (options.threadTs) {
          // Fetch thread replies
          spinner.text = 'Fetching thread replies...';
          response = await client.getConversationReplies(channelId, options.threadTs, {
            limit: parseInt(options.limit),
            oldest,
            latest,
            cursor: options.cursor,
          });
          messages = response.messages || [];
        } else {
          // Fetch conversation history
          spinner.text = 'Fetching conversation history...';
          response = await client.getConversationHistory(channelId, {
            limit: parseInt(options.limit),
            oldest,
            latest,
            cursor: options.cursor,
          });
          messages = response.messages || [];

          // Filter out replies if requested
          if (options.excludeReplies) {
            messages = messages.filter(msg => !msg.thread_ts || msg.thread_ts === msg.ts);
          }
        }

        // Reverse to show oldest first
        messages.reverse();

        // Fetch user info for messages
        const userIds = new Set<string>();
        messages.forEach(msg => {
          if (msg.user) {
            userIds.add(msg.user);
          }
        });

        const users = new Map<string, SlackUser>();
        if (userIds.size > 0) {
          spinner.text = 'Fetching user information...';
          const usersResponse = await client.getUsersInfo(Array.from(userIds));
          usersResponse.users?.forEach((user: SlackUser) => {
            users.set(user.id, user);
          });
        }

        // Build parent message map for thread context
        const parents = new Map<string, SlackMessage>();
        messages.forEach(msg => {
          if (msg.thread_ts === msg.ts) {
            parents.set(msg.ts, msg);
          }
        });

        // Get workspace URL for permalinks
        const workspace = await getWorkspace(options.workspace);
        let workspaceUrl: string | undefined;
        if (workspace) {
          if (workspace.auth_type === 'browser') {
            workspaceUrl = workspace.workspace_url;
          } else {
            // For standard auth, construct URL from team info
            const authTest = await client.testAuth();
            if (authTest.url) {
              workspaceUrl = authTest.url;
            }
          }
        }

        spinner.succeed(`Found ${messages.length} messages`);

        // Output in JSON format if requested
        if (options.json) {
          console.log(JSON.stringify({
            channel_id: channelId,
            message_count: messages.length,
            messages: messages.map(msg => ({
              ts: msg.ts,
              thread_ts: msg.thread_ts,
              user: msg.user,
              text: msg.text,
              type: msg.type,
              reply_count: msg.reply_count,
              reactions: msg.reactions,
              bot_id: msg.bot_id,
            })),
            users: Array.from(users.values()).map(u => ({
              id: u.id,
              name: u.name,
              real_name: u.real_name,
              email: u.profile?.email,
            })),
            next_cursor: response.response_metadata?.next_cursor,
          }, null, 2));
        } else {
          console.log('\n' + formatConversationHistory(channelId, messages, users, parents, workspaceUrl, channelId));

          // Show pagination hint if there are more results
          if (response.response_metadata?.next_cursor) {
            console.log('\n' + chalk.dim('To see more results:'));
            console.log(chalk.cyan(`  slack conversations read ${channelId} --cursor=${response.response_metadata.next_cursor}${options.limit ? ` --limit=${options.limit}` : ''}${oldest ? ` --oldest=${oldest}` : ''}${latest ? ` --latest=${latest}` : ''}`));
          }
        }
      } catch (err: any) {
        spinner.fail('Failed to fetch messages');
        error(err.message);
        process.exit(1);
      }
    });

  return conversations;
}

