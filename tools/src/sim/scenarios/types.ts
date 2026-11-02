import type { FightResult } from '../simulateFight.ts';
export interface Check { label: string; expected: string; actual: string; ok: boolean }
export interface ScenarioOut { result?: FightResult; metrics: Record<string, number | string>; checks: Check[]; skipped?: string }
export interface Scenario { name: string; run(seed: number): ScenarioOut }
