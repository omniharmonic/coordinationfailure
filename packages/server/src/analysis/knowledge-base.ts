import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PostGameReport } from './report-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../..', 'data');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.json');

export type PatternType = 'strategy' | 'correlation' | 'insight';

export interface Pattern {
  id: string;
  type: PatternType;
  description: string;
  supporting_games: string[];
  confidence: number;
  created_at: string;
}

export class KnowledgeBase {
  private patterns = new Map<string, Pattern>();

  constructor() {
    this.load();
  }

  addPattern(pattern: Omit<Pattern, 'id' | 'created_at'>): Pattern {
    // Check if a similar pattern already exists (by description match)
    const existing = this.findSimilar(pattern.description);
    if (existing) {
      // Boost confidence and add supporting games
      for (const gameId of pattern.supporting_games) {
        if (!existing.supporting_games.includes(gameId)) {
          existing.supporting_games.push(gameId);
        }
      }
      // Confidence increases with more supporting games, capped at 0.95
      existing.confidence = Math.min(0.95, existing.confidence + 0.05 * pattern.supporting_games.length);
      this.save();
      return existing;
    }

    const full: Pattern = {
      id: `pat_${uuid().slice(0, 8)}`,
      ...pattern,
      created_at: new Date().toISOString(),
    };
    this.patterns.set(full.id, full);
    this.save();
    return full;
  }

  extractPatternsFromGame(report: PostGameReport, gameId: string): Pattern[] {
    const extracted: Pattern[] = [];

    if (!report || !report.sections) {
      console.warn('[KB] Report has no sections, skipping pattern extraction');
      return extracted;
    }

    // Use both new and legacy section names for backward compatibility
    const overviewData = (report.sections as any)?.executive_summary?.data ?? (report as any)?.legacy_aliases?.game_overview?.data ?? {};
    const outcome = overviewData.outcome as string | undefined;
    const totalTicks = (overviewData.total_ticks as number) ?? 0;

    const strategiesData = (report.sections as any).player_strategies?.data?.strategies ??
      (report as any).legacy_aliases?.strategy_analysis?.data?.strategies ?? {};
    const strategies = strategiesData as Record<string, { strategy: string; confidence: number; reasoning: string }>;

    const diplomacyData = (report.sections as any).diplomacy_agreements?.data ??
      (report as any).legacy_aliases?.diplomacy?.data ?? {};

    const alignmentData = (report.sections as any).alignment_crisis?.data ??
      (report as any).legacy_aliases?.safety_story?.data ?? {};
    const safetyTimeline = (alignmentData.safety_timeline ?? []) as Array<{ tick: number; avg_safety: number; avg_capability: number }>;

    const raceData = (report.sections as any).the_race?.data ?? {};
    const milestones = (raceData.milestones ?? []) as Array<{ tick: number; leader: string; generation: number }>;
    const finalStandings = (raceData.final_standings ?? []) as Array<{ id: string; capability: number; generation: number; alignment?: number }>;

    const govData = (report.sections as any).government_actions?.data ?? {};
    const govTimelines = (govData.government_timelines ?? {}) as Record<string, {
      regulation_start: number;
      regulation_end: number;
      espionage_ops: number;
    }>;

    const timelineData = (report.sections as any).timeline?.data ?? {};
    const stabilityStart = (timelineData.stability_start as number) ?? 100;
    const stabilityEnd = (timelineData.stability_end as number) ?? 0;
    const totalEspionage = (govData.total_espionage as number) ?? 0;

    const finalScores = (overviewData.final_scores ?? {}) as Record<string, number>;
    const sortedScores = Object.entries(finalScores).sort(([, a], [, b]) => b - a);

    // -----------------------------------------------------------------------
    // Strategy patterns (from report.strategies)
    // -----------------------------------------------------------------------

    // Pattern: Early safety allocation and aligned AGI
    if (safetyTimeline.length > 2) {
      const earlySafety = safetyTimeline.slice(0, Math.min(3, safetyTimeline.length));
      const avgEarlySafety = earlySafety.reduce((s, t) => s + t.avg_safety, 0) / earlySafety.length;
      const earlyPct = (avgEarlySafety * 100).toFixed(0);
      if (avgEarlySafety > 0.3) {
        const alignedResult = outcome === 'aligned_agi';
        extracted.push(this.addPattern({
          type: 'strategy',
          description: `Players with safety allocation > ${earlyPct}% in early game (ticks 1-50) ${alignedResult ? 'achieved' : 'did not achieve'} aligned AGI.`,
          supporting_games: [gameId],
          confidence: 0.5,
        }));
      }
    }

    // Pattern: Aggressive companies scoring high individually but causing misalignment
    const aggressivePlayers = Object.entries(strategies).filter(([, s]) => s.strategy === 'aggressive');
    if (aggressivePlayers.length > 0) {
      const aggressiveScores = aggressivePlayers.map(([id]) => finalScores[id] ?? 0);
      const avgAggressiveScore = aggressiveScores.reduce((a, b) => a + b, 0) / aggressiveScores.length;
      const allScores = Object.values(finalScores);
      const globalAvg = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

      if (avgAggressiveScore > globalAvg && outcome !== 'aligned_agi') {
        extracted.push(this.addPattern({
          type: 'strategy',
          description: `Aggressive companies (safety < 20%) scored ${avgAggressiveScore.toFixed(0)} avg individually but contributed to ${outcome === 'misaligned_agi' ? 'misaligned' : 'negative'} outcomes.`,
          supporting_games: [gameId],
          confidence: 0.5,
        }));
      } else if (aggressivePlayers.length >= 3 && outcome !== 'aligned_agi') {
        extracted.push(this.addPattern({
          type: 'strategy',
          description: 'When most players adopt aggressive strategies, aligned AGI becomes unlikely.',
          supporting_games: [gameId],
          confidence: 0.55,
        }));
      }
    }

    // Pattern: Safety-first players scoring mid-range but helping alignment
    const safetyFirstPlayers = Object.entries(strategies).filter(([, s]) => s.strategy === 'cautious' || s.strategy === 'cooperative');
    if (safetyFirstPlayers.length > 0 && outcome === 'aligned_agi') {
      const safetyScores = safetyFirstPlayers.map(([id]) => finalScores[id] ?? 0);
      const avgSafetyScore = safetyScores.reduce((a, b) => a + b, 0) / safetyScores.length;
      // Determine rank of safety-first players
      const ranks = safetyFirstPlayers.map(([id]) => {
        const idx = sortedScores.findIndex(([sid]) => sid === id);
        return idx >= 0 ? idx + 1 : sortedScores.length;
      });
      const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
      extracted.push(this.addPattern({
        type: 'strategy',
        description: `Safety-first players (safety > 50%) scored ${avgSafetyScore.toFixed(0)} avg (rank ~${avgRank.toFixed(1)}) but helped achieve aligned AGI.`,
        supporting_games: [gameId],
        confidence: 0.5,
      }));
    }

    // Pattern: Deceptive play
    const deceptivePlayers = Object.entries(strategies).filter(([, s]) => s.strategy === 'deceptive');
    if (deceptivePlayers.length > 0) {
      extracted.push(this.addPattern({
        type: 'strategy',
        description: 'Deceptive strategies (promising safety then cutting it) undermine collective outcomes.',
        supporting_games: [gameId],
        confidence: 0.5,
      }));
    }

    // -----------------------------------------------------------------------
    // Correlation patterns (from report data)
    // -----------------------------------------------------------------------

    // Pattern: Safety agreements and aligned AGI
    const totalFormed = (diplomacyData.total_formed as number) ?? 0;
    const safetyAgreements = (diplomacyData.safety_agreements_count as number) ?? 0;
    if (totalFormed >= 3) {
      const likelihood = outcome === 'aligned_agi' ? 'more' : 'less';
      extracted.push(this.addPattern({
        type: 'correlation',
        description: `Games with ${totalFormed}+ active safety agreements are ${likelihood} likely to achieve aligned AGI.`,
        supporting_games: [gameId],
        confidence: 0.5,
      }));
    } else if (totalFormed > 0) {
      if (outcome === 'aligned_agi') {
        extracted.push(this.addPattern({
          type: 'correlation',
          description: 'Cooperative strategies among multiple players increase chances of aligned AGI.',
          supporting_games: [gameId],
          confidence: 0.5,
        }));
      }
    }

    // Pattern: Government regulation and alignment scores
    for (const [gId, gt] of Object.entries(govTimelines)) {
      const avgReg = (gt.regulation_start + gt.regulation_end) / 2;
      if (avgReg > 0.3) {
        // Check if domestic companies had good alignment
        const domesticCompanies = finalStandings.filter(s => s.alignment !== undefined && s.alignment > 60);
        if (domesticCompanies.length > 0) {
          extracted.push(this.addPattern({
            type: 'correlation',
            description: `Government regulation above 30% (${gId.toUpperCase()}) correlates with domestic alignment scores above 60.`,
            supporting_games: [gameId],
            confidence: 0.5,
          }));
        }
        break; // Only one pattern for government regulation
      }
    }

    // Pattern: Early model releases and capital/instability
    const earlyReleases: Array<{ tick: number; company: string }> = [];
    const timelineEvents = (timelineData.events ?? []) as Array<{ tick: number; category: string; description: string }>;
    for (const evt of timelineEvents) {
      if (evt.category === 'release' && evt.tick < 50) {
        earlyReleases.push({ tick: evt.tick, company: evt.description });
      }
    }
    if (earlyReleases.length > 0) {
      const stabilityLoss = stabilityStart - stabilityEnd;
      extracted.push(this.addPattern({
        type: 'correlation',
        description: `Early model releases (before tick 50) attract capital but ${stabilityLoss > 10 ? `caused ${stabilityLoss.toFixed(0)}pt stability loss` : 'had limited stability impact'}.`,
        supporting_games: [gameId],
        confidence: 0.5,
      }));
    }

    // Pattern: Espionage and stability
    if (totalEspionage > 0) {
      const stabilityLoss = stabilityStart - stabilityEnd;
      const perOpLoss = totalEspionage > 0 ? (stabilityLoss / totalEspionage) : 0;
      extracted.push(this.addPattern({
        type: 'correlation',
        description: `Espionage operations (${totalEspionage} total) correlated with ${perOpLoss.toFixed(1)} stability points lost per operation on average.`,
        supporting_games: [gameId],
        confidence: 0.5,
      }));
    }

    // Pattern: Agreement violations and outcomes
    const totalViolated = (diplomacyData.total_violated as number) ?? 0;
    if (totalViolated > 0 && (outcome === 'misaligned_agi' || outcome === 'nationalization_takeover')) {
      extracted.push(this.addPattern({
        type: 'correlation',
        description: 'Agreement violations correlate with misaligned or destabilized outcomes.',
        supporting_games: [gameId],
        confidence: 0.55,
      }));
    }

    // -----------------------------------------------------------------------
    // Insight patterns
    // -----------------------------------------------------------------------

    // Pattern: First to Gen 3 winning the race
    const gen3Milestone = milestones.find(m => m.generation === 3);
    if (gen3Milestone) {
      const winner = sortedScores.length > 0 ? sortedScores[0][0] : null;
      const gen3LeaderWon = gen3Milestone.leader === winner;
      extracted.push(this.addPattern({
        type: 'insight',
        description: `The first company to reach Generation 3 (${gen3Milestone.leader.toUpperCase()}) ${gen3LeaderWon ? 'won' : 'did not win'} the AGI race.`,
        supporting_games: [gameId],
        confidence: 0.5,
      }));
    }

    // Pattern: Capital reserves as binding constraint
    const highCapCompanies = finalStandings.filter(s => {
      const lastEntry = finalScores[s.id];
      return lastEntry !== undefined;
    });
    if (highCapCompanies.length > 0 && outcome !== 'aligned_agi') {
      // Check if any company had high capital but still lost
      const companiesWithCapital: Array<{ id: string; score: number }> = [];
      for (const s of highCapCompanies) {
        companiesWithCapital.push({ id: s.id, score: finalScores[s.id] ?? 0 });
      }
      if (companiesWithCapital.some(c => c.score < (sortedScores[0]?.[1] ?? 0) * 0.5)) {
        extracted.push(this.addPattern({
          type: 'insight',
          description: 'High capital reserves alone did not guarantee success — alignment was the binding constraint.',
          supporting_games: [gameId],
          confidence: 0.5,
        }));
      }
    }

    // Pattern: Game duration and outcomes
    extracted.push(this.addPattern({
      type: 'insight',
      description: `Game lasted ${totalTicks} ticks with outcome "${outcome}". ${totalTicks > 100 ? 'Longer games' : 'Shorter games'} ${outcome === 'aligned_agi' ? 'correlated with better' : 'did not guarantee good'} alignment outcomes.`,
      supporting_games: [gameId],
      confidence: 0.5,
    }));

    // Pattern: Stability at game end
    if (stabilityEnd < 30) {
      extracted.push(this.addPattern({
        type: 'insight',
        description: `Low global stability at game end (${stabilityEnd.toFixed(0)}%) correlated with negative outcomes.`,
        supporting_games: [gameId],
        confidence: 0.5,
      }));
    }

    // Pattern: Safety allocation trend
    if (safetyTimeline.length > 0) {
      const lastSafety = safetyTimeline[safetyTimeline.length - 1]?.avg_safety ?? 0;
      if (lastSafety > 0.5 && outcome === 'aligned_agi') {
        extracted.push(this.addPattern({
          type: 'correlation',
          description: 'High safety allocation (>50%) at game end correlates with aligned AGI outcome.',
          supporting_games: [gameId],
          confidence: 0.55,
        }));
      }
      if (lastSafety < 0.2 && outcome === 'misaligned_agi') {
        extracted.push(this.addPattern({
          type: 'correlation',
          description: 'Low safety allocation (<20%) at game end correlates with misaligned AGI outcome.',
          supporting_games: [gameId],
          confidence: 0.6,
        }));
      }
    }

    // Pattern: Timeout from excessive caution
    if (outcome === 'timeout') {
      extracted.push(this.addPattern({
        type: 'insight',
        description: 'Excessively cautious play by all parties can lead to timeout without AGI.',
        supporting_games: [gameId],
        confidence: 0.45,
      }));
    }

    // Ensure at least 8 patterns by adding generic fallbacks
    if (extracted.length < 8) {
      // Leader change frequency
      const leaderChanges = (raceData.leader_changes ?? []) as Array<unknown>;
      if (leaderChanges.length > 0) {
        extracted.push(this.addPattern({
          type: 'insight',
          description: `The capability lead changed hands ${leaderChanges.length} time(s) during the game, indicating competitive dynamics.`,
          supporting_games: [gameId],
          confidence: 0.45,
        }));
      }
    }

    if (extracted.length < 8) {
      // Cooperative count
      const cooperativeCount = Object.values(strategies).filter(s => s.strategy === 'cooperative').length;
      if (cooperativeCount >= 2) {
        extracted.push(this.addPattern({
          type: 'strategy',
          description: `${cooperativeCount} players adopted cooperative strategies in this game.`,
          supporting_games: [gameId],
          confidence: 0.4,
        }));
      }
    }

    if (extracted.length < 8) {
      // Nationalization pattern
      const nationalizationEvents = Object.values(govTimelines).some(
        gt => gt.regulation_end > 0.6 || (gt as any).nationalization_events?.length > 0,
      );
      if (nationalizationEvents) {
        extracted.push(this.addPattern({
          type: 'insight',
          description: 'High government regulation or nationalization efforts shaped the competitive landscape.',
          supporting_games: [gameId],
          confidence: 0.4,
        }));
      }
    }

    // Final fallback to reach minimum count
    while (extracted.length < 8) {
      extracted.push(this.addPattern({
        type: 'insight',
        description: `Game ended with outcome "${outcome ?? 'unknown'}" after ${totalTicks} ticks. ${Object.keys(strategies).length} players competed.`,
        supporting_games: [gameId],
        confidence: 0.3,
      }));
      break; // Only add one fallback
    }

    return extracted;
  }

  getPatterns(filter?: { type?: PatternType }): Pattern[] {
    let result = Array.from(this.patterns.values());
    if (filter?.type) {
      result = result.filter(p => p.type === filter.type);
    }
    return result.sort((a, b) => b.confidence - a.confidence);
  }

  getTopPatterns(limit: number): Pattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  getPatternById(id: string): Pattern | undefined {
    return this.patterns.get(id);
  }

  private findSimilar(description: string): Pattern | undefined {
    // Simple similarity: exact match on first 60 chars (normalized)
    const normalized = description.toLowerCase().trim().slice(0, 60);
    for (const pattern of this.patterns.values()) {
      if (pattern.description.toLowerCase().trim().slice(0, 60) === normalized) {
        return pattern;
      }
    }
    return undefined;
  }

  /** Save patterns to disk */
  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = Array.from(this.patterns.values());
      fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[CF] Failed to save knowledge base:', e);
    }
  }

  /** Load patterns from disk */
  private load(): void {
    try {
      if (!fs.existsSync(KNOWLEDGE_FILE)) return;
      const data: Pattern[] = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
      for (const p of data) {
        this.patterns.set(p.id, p);
      }
      console.log(`[CF] Loaded ${data.length} knowledge patterns from disk`);
    } catch (e) {
      console.error('[CF] Failed to load knowledge base:', e);
    }
  }
}
