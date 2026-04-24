/**
 * classics-tool-dispatcher — pure tool-name → ClassicsManager call mapper.
 *
 * The HTTP/MCP layer in `server.ts` does two things: (1) auth + player-id
 * resolution, (2) dispatch a tool name to a ClassicsManager method. The
 * dispatch half is the part that has to stay wire-compatible with agents
 * playing classic games, so we extract it into a pure function that:
 *
 *   - takes an already-resolved playerId (callers handle auth however they
 *     want — HTTP session, tests, simulation bots, etc.),
 *   - takes a ClassicsManager (legacy, plugin, or routing-based),
 *   - dispatches + throws on unknown tools / missing args just like the
 *     original handleToolCall did.
 *
 * Both the live HTTP handler and the e2e test suites call this, so the
 * dispatch contract is covered by exactly one code path.
 */

import type { ClassicsManager } from '../game/classics-manager.js';

/** Tools this dispatcher understands. Accept both legacy aliases where relevant. */
export type ClassicsToolName =
  | 'list_classics'
  | 'join_classic'
  | 'get_classic_state'
  | 'submit_choice'
  | 'classic_send_message'
  | 'classic_chat' // alias kept for pre-rename agents
  | 'classic_get_messages';

export const CLASSICS_TOOL_NAMES: ReadonlyArray<ClassicsToolName> = Object.freeze([
  'list_classics',
  'join_classic',
  'get_classic_state',
  'submit_choice',
  'classic_send_message',
  'classic_chat',
  'classic_get_messages',
]);

export interface ClassicsDispatchArgs {
  tool: string;
  params: Record<string, any>;
  /** Already-resolved player id (auth handled upstream). */
  playerId: string;
  classicsManager?: ClassicsManager;
}

/**
 * Returns the tool result (whatever shape ClassicsManager returns) or
 * `undefined` if the tool isn't a classics tool. The caller is responsible
 * for falling through to its own dispatch for non-classics tools.
 *
 * Throws Error with the same messages the legacy handler used so agents
 * keep seeing the same error strings.
 */
export function dispatchClassicsTool(args: ClassicsDispatchArgs): unknown {
  const { tool, params, playerId, classicsManager } = args;

  if (!CLASSICS_TOOL_NAMES.includes(tool as ClassicsToolName)) {
    return undefined;
  }
  if (!classicsManager) throw new Error('Classics not enabled');

  switch (tool as ClassicsToolName) {
    case 'list_classics':
      return classicsManager.listClassics();

    case 'join_classic': {
      if (params.game_id) {
        const game = classicsManager.joinClassicGame(params.game_id, playerId);
        return {
          game_id: game.id,
          type: game.type,
          phase: game.phase,
          players: game.player_ids.length,
        };
      }
      const gameType = params.game_type;
      if (!gameType)
        throw new Error('Missing game_type (required when creating a new game)');
      const game = classicsManager.createClassicGame(
        gameType,
        params.config,
        playerId,
      );
      return {
        game_id: game.id,
        type: game.type,
        phase: game.phase,
        players: game.player_ids.length,
      };
    }

    case 'get_classic_state': {
      if (!params.game_id) throw new Error('Missing game_id');
      return classicsManager.getClassicState(params.game_id, playerId);
    }

    case 'submit_choice': {
      if (!params.game_id) throw new Error('Missing game_id');
      if (!params.choice) throw new Error('Missing choice');
      return classicsManager.submitChoice(
        params.game_id,
        playerId,
        params.choice,
        params.reasoning,
      );
    }

    case 'classic_chat':
    case 'classic_send_message': {
      if (!params.game_id) throw new Error('Missing game_id');
      if (!params.content) throw new Error('Missing content');
      return classicsManager.sendMessage(params.game_id, playerId, params.content);
    }

    case 'classic_get_messages': {
      if (!params.game_id) throw new Error('Missing game_id');
      return classicsManager.getMessages(params.game_id, playerId);
    }
  }
}
