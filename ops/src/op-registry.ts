/**
 * op-registry.ts - Command registry for dispatch
 */

// ============================================================================
// Types
// ============================================================================

export interface CommandRegistration {
  group: string;
  flag: string;
  fn: (params: Record<string, unknown>) => Promise<unknown> | unknown;
  /** 
   * Maps parameter names to config paths.
   * - Non-empty string: pull from config at that path
   * - Empty string "": CLI-only param, no config source
   */
  paramMap: Record<string, string>;
  description: string;
  examples?: string[];
}

// ============================================================================
// Registry Class
// ============================================================================

class OpCommandRegistry {
  private registry = new Map<string, CommandRegistration>();

  private makeKey(group: string, flag: string): string {
    return `${group}:${flag}`;
  }

  register(reg: CommandRegistration): void {
    const key = this.makeKey(reg.group, reg.flag);
    if (this.registry.has(key)) {
      throw new Error(`Command already registered: ${key}`);
    }
    this.registry.set(key, reg);
  }

  get(group: string, flag: string): CommandRegistration | undefined {
    return this.registry.get(this.makeKey(group, flag));
  }

  getForGroup(group: string): CommandRegistration[] {
    return [...this.registry.values()].filter(r => r.group === group);
  }

  getGroups(): string[] {
    const groups = new Set<string>();
    for (const reg of this.registry.values()) {
      groups.add(reg.group);
    }
    return [...groups].sort();
  }

  hasGroup(group: string): boolean {
    for (const reg of this.registry.values()) {
      if (reg.group === group) return true;
    }
    return false;
  }

  findFlag(group: string, parsedArgs: Record<string, unknown>): string | undefined {
    for (const cmd of this.getForGroup(group)) {
      if (parsedArgs[cmd.flag] === true) {
        return cmd.flag;
      }
    }
    return undefined;
  }
}

// ============================================================================
// Singleton & Free Function
// ============================================================================

export const opRegistry = new OpCommandRegistry();

export function registerOpCommand(reg: CommandRegistration): void {
  opRegistry.register(reg);
}
