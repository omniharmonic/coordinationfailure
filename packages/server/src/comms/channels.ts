import type { GameState } from '@cf/engine';
import { v4 as uuid } from 'uuid';

export interface Message {
  id: string;
  channel_id: string;
  from: string;
  content: string;
  timestamp: number;
  game_tick?: number;
}

export interface Channel {
  id: string;
  type: 'public' | 'country' | 'dm' | 'group';
  game_id: string;
  name: string;
  members: string[];
  created_by: string;
  created_at: Date;
}

export class ChannelManager {
  private channels = new Map<string, Channel>();
  private messages = new Map<string, Message[]>(); // channelId -> messages
  private gameChannels = new Map<string, Set<string>>(); // gameId -> set of channelIds
  private roleChannels = new Map<string, Set<string>>(); // "gameId:roleId" -> set of channelIds

  initializeGameChannels(gameId: string, state: GameState): void {
    const channelSet = new Set<string>();

    // Public broadcast
    const publicChannel = this.createChannelInternal(gameId, 'public', 'Global Broadcast', Object.keys(state.roles), 'system');
    channelSet.add(publicChannel.id);

    // Country channels
    const usRoles = Object.entries(state.roles).filter(([_, r]) => r.country === 'us').map(([id]) => id);
    const chinaRoles = Object.entries(state.roles).filter(([_, r]) => r.country === 'china').map(([id]) => id);

    const usChannel = this.createChannelInternal(gameId, 'country', 'US Channel', usRoles, 'system');
    const chinaChannel = this.createChannelInternal(gameId, 'country', 'China Channel', chinaRoles, 'system');

    channelSet.add(usChannel.id);
    channelSet.add(chinaChannel.id);

    this.gameChannels.set(gameId, channelSet);
  }

  private createChannelInternal(gameId: string, type: Channel['type'], name: string, members: string[], createdBy: string): Channel {
    const channel: Channel = {
      id: `ch_${type}_${uuid().slice(0, 8)}`,
      type,
      game_id: gameId,
      name,
      members,
      created_by: createdBy,
      created_at: new Date(),
    };

    this.channels.set(channel.id, channel);
    this.messages.set(channel.id, []);

    // Index by role
    for (const roleId of members) {
      const key = `${gameId}:${roleId}`;
      if (!this.roleChannels.has(key)) {
        this.roleChannels.set(key, new Set());
      }
      this.roleChannels.get(key)!.add(channel.id);
    }

    return channel;
  }

  createChannel(gameId: string, creatorRoleId: string, type: 'dm' | 'group', inviteIds: string[]): Channel {
    const members = [creatorRoleId, ...inviteIds.filter(id => id !== creatorRoleId)];
    const name = type === 'dm' ? `DM: ${members.join(', ')}` : `Group: ${members.join(', ')}`;
    const channel = this.createChannelInternal(gameId, type, name, members, creatorRoleId);

    const gameSet = this.gameChannels.get(gameId) ?? new Set();
    gameSet.add(channel.id);
    this.gameChannels.set(gameId, gameSet);

    return { id: channel.id, type: channel.type, name: channel.name, members: channel.members } as Channel;
  }

  sendMessage(gameId: string, fromRoleId: string, channelId: string, content: string): Message {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('Channel not found');
    if (channel.game_id !== gameId) throw new Error('Channel not in this game');
    if (!channel.members.includes(fromRoleId)) throw new Error('Not a member of this channel');

    const message: Message = {
      id: uuid(),
      channel_id: channelId,
      from: fromRoleId,
      content,
      timestamp: Date.now(),
    };

    const msgs = this.messages.get(channelId) ?? [];
    msgs.push(message);
    this.messages.set(channelId, msgs);

    return message;
  }

  getMessages(gameId: string, channelId: string, roleId: string, since?: string): Message[] {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('Channel not found');
    if (!channel.members.includes(roleId)) throw new Error('Not a member of this channel');

    const msgs = this.messages.get(channelId) ?? [];
    if (since) {
      const sinceTime = new Date(since).getTime();
      return msgs.filter(m => m.timestamp > sinceTime);
    }
    return msgs.slice(-50); // Last 50 messages by default
  }

  listChannels(gameId: string, roleId: string): Array<{ id: string; type: string; name: string; unread: number }> {
    const key = `${gameId}:${roleId}`;
    const channelIds = this.roleChannels.get(key) ?? new Set();

    return Array.from(channelIds).map(chId => {
      const channel = this.channels.get(chId)!;
      const msgs = this.messages.get(chId) ?? [];
      return {
        id: channel.id,
        type: channel.type,
        name: channel.name,
        unread: msgs.length, // simplified — in production, track read cursors
      };
    });
  }

  getChannelsForRole(gameId: string, roleId: string): Channel[] {
    const key = `${gameId}:${roleId}`;
    const channelIds = this.roleChannels.get(key) ?? new Set();
    return Array.from(channelIds).map(id => this.channels.get(id)!).filter(Boolean);
  }

  /** Get public channel messages for spectator view (no auth required) */
  getPublicMessages(gameId: string): Message[] {
    const channelIds = this.gameChannels.get(gameId);
    if (!channelIds) return [];

    for (const chId of channelIds) {
      const channel = this.channels.get(chId);
      if (channel?.type === 'public') {
        const msgs = this.messages.get(chId) ?? [];
        return msgs.slice(-100);
      }
    }
    return [];
  }

  /** Get ALL messages across ALL channels for a game (for replay/post-game analysis) */
  getAllMessages(gameId: string): Array<Message & { channel_name: string; channel_type: string }> {
    const channelIds = this.gameChannels.get(gameId);
    if (!channelIds) return [];

    const allMsgs: Array<Message & { channel_name: string; channel_type: string }> = [];
    for (const chId of channelIds) {
      const channel = this.channels.get(chId);
      if (!channel) continue;
      const msgs = this.messages.get(chId) ?? [];
      for (const msg of msgs) {
        allMsgs.push({
          ...msg,
          channel_name: channel.name,
          channel_type: channel.type,
        });
      }
    }

    // Sort by timestamp
    allMsgs.sort((a, b) => a.timestamp - b.timestamp);
    return allMsgs;
  }
}
