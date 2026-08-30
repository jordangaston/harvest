import type { Tool } from '@mastra/core/tools';
import { saveHouseholdProfileTool, canRun as canRunHousehold, execute as executeHousehold } from './save-household-profile.js';
import { saveMemberProfileTool, canRun as canRunMember, execute as executeMember } from './save-member-profile.js';
import { searchCatalogTool, canRun as canRunSearch, execute as executeSearch } from './search-catalog.js';
import type { ChefState, SaveResult, ToolCtx } from './types.js';

/**
 * One command tool paired with its two pure/impure halves (WI-03 keeps `canRun` a
 * separate pure function, not a Mastra concept). The registry is the single point
 * the reasoning agent and briefing read to filter by legality and dispatch a call.
 */
export interface ToolEntry {
  id: string;
  tool: Tool<any, any>;
  /** Legality gate — a pure function of state (some tools read `state.args`). */
  canRun(state: ChefState): boolean;
  /** The in-process service call. `input` is the parsed tool args. */
  execute(input: any, ctx: ToolCtx): Promise<SaveResult | { candidates: unknown[] }>;
}

/** Every command tool the Chef can run, keyed by tool id. */
export const TOOL_REGISTRY: Record<string, ToolEntry> = {
  [saveHouseholdProfileTool.id]: { id: saveHouseholdProfileTool.id, tool: saveHouseholdProfileTool, canRun: canRunHousehold, execute: executeHousehold },
  [saveMemberProfileTool.id]: { id: saveMemberProfileTool.id, tool: saveMemberProfileTool, canRun: canRunMember, execute: executeMember },
  [searchCatalogTool.id]: { id: searchCatalogTool.id, tool: searchCatalogTool, canRun: canRunSearch, execute: executeSearch },
};

/** Legality for a tool by id — unknown ids are never legal. */
export function canRunByName(toolId: string, state: ChefState): boolean {
  return TOOL_REGISTRY[toolId]?.canRun(state) ?? false;
}
