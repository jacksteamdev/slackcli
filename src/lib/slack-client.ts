import { WebClient } from '@slack/web-api';
import type { WorkspaceConfig, SlackAuthTestResponse } from '../types/index.ts';

export class SlackClient {
  private config: WorkspaceConfig;
  private webClient?: WebClient;

  constructor(config: WorkspaceConfig) {
    this.config = config;
    
    // Only use WebClient for standard auth
    if (config.auth_type === 'standard') {
      this.webClient = new WebClient(config.token);
    }
  }

  // Make API request (handles both auth types)
  async request(method: string, params: Record<string, any> = {}): Promise<any> {
    if (this.config.auth_type === 'standard') {
      return this.standardRequest(method, params);
    } else {
      return this.browserRequest(method, params);
    }
  }

  // Standard token request (using @slack/web-api)
  private async standardRequest(method: string, params: Record<string, any>): Promise<any> {
    if (!this.webClient) {
      throw new Error('WebClient not initialized');
    }

    try {
      const response = await this.webClient.apiCall(method, params);
      return response;
    } catch (error: any) {
      throw new Error(`Slack API error: ${error.message}`);
    }
  }

  // Browser token request (custom implementation)
  private async browserRequest(method: string, params: Record<string, any>): Promise<any> {
    if (this.config.auth_type !== 'browser') {
      throw new Error('Invalid auth type');
    }

    const url = `${this.config.workspace_url}/api/${method}`;
    
    const formBody = new URLSearchParams({
      token: this.config.xoxc_token,
      ...params,
    });

    try {
      // Do NOT URL-encode the xoxd token - use raw value
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Cookie': `d=${this.config.xoxd_token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: formBody,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: any = await response.json();

      if (!data.ok) {
        throw new Error(data.error || 'Unknown API error');
      }

      return data;
    } catch (error: any) {
      throw new Error(`Slack API error: ${error.message}`);
    }
  }

  // Test authentication
  async testAuth(): Promise<SlackAuthTestResponse> {
    return this.request('auth.test', {});
  }

  // List conversations
  async listConversations(options: {
    types?: string;
    limit?: number;
    exclude_archived?: boolean;
    cursor?: string;
  } = {}): Promise<any> {
    return this.request('conversations.list', options);
  }

  // Get conversation info
  async getConversationInfo(channel: string): Promise<any> {
    return this.request('conversations.info', { channel });
  }

  // Get conversation history
  async getConversationHistory(channel: string, options: {
    cursor?: string;
    latest?: string;
    oldest?: string;
    inclusive?: boolean;
    limit?: number;
  } = {}): Promise<any> {
    // Filter out undefined values
    const params: Record<string, any> = { channel };
    if (options.cursor) params.cursor = options.cursor;
    if (options.latest) params.latest = options.latest;
    if (options.oldest) params.oldest = options.oldest;
    if (options.inclusive !== undefined) params.inclusive = options.inclusive;
    if (options.limit) params.limit = options.limit;
    
    return this.request('conversations.history', params);
  }

  // Get conversation replies (thread)
  async getConversationReplies(channel: string, ts: string, options: {
    cursor?: string;
    latest?: string;
    oldest?: string;
    inclusive?: boolean;
    limit?: number;
  } = {}): Promise<any> {
    const params: Record<string, any> = { channel, ts };
    if (options.cursor) params.cursor = options.cursor;
    if (options.latest) params.latest = options.latest;
    if (options.oldest) params.oldest = options.oldest;
    if (options.inclusive !== undefined) params.inclusive = options.inclusive;
    if (options.limit) params.limit = options.limit;
    
    return this.request('conversations.replies', params);
  }

  // Get user info
  async getUserInfo(userId: string): Promise<any> {
    return this.request('users.info', { user: userId });
  }

  // Get multiple users info
  async getUsersInfo(userIds: string[]): Promise<any> {
    const users: any[] = [];

    for (const userId of userIds) {
      try {
        const response = await this.getUserInfo(userId);
        if (response.ok && response.user) {
          users.push(response.user);
        }
      } catch (error) {
        // Skip users we can't fetch
        console.error(`Failed to fetch user ${userId}`);
      }
    }

    return { ok: true, users };
  }

  // Search messages
  async searchMessages(query: string, options: {
    sort?: string;
    count?: number;
    channel?: string;
  } = {}): Promise<any> {
    const params: Record<string, any> = { query };
    if (options.sort) params.sort = options.sort;
    if (options.count) params.count = options.count;

    // Add channel filter to query if specified
    let searchQuery = query;
    if (options.channel) {
      searchQuery = `${query} in:<#${options.channel}>`;
    }
    params.query = searchQuery;

    return this.request('search.messages', params);
  }
}

