/**
 * Command Metadata - Single source of truth for command classifications
 * 
 * All command behavior flags should be defined here, not scattered across
 * multiple files with independent switch statements.
 */

export interface CommandMeta {
  /** Whether this command modifies the trip journal (persisted) */
  journalable: boolean;
  /** Whether the chatbot can execute this command */
  chatbotExecutable: boolean;
  /** Whether this command requires a follow-up GPT call (e.g., websearch) */
  requiresChaining: boolean;
  /** Whether this command gets a UID injected by the server */
  injectsUid: boolean;
  /** Whether this is an administrative/maintenance command */
  administrative: boolean;
}

const COMMAND_METADATA: Record<string, CommandMeta> = {
  // Journalable commands that modify trip data
  newtrip:     { journalable: true,  chatbotExecutable: false, requiresChaining: false, injectsUid: false, administrative: false },
  add:         { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: true,  administrative: false },
  edit:        { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  delete:      { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  addcountry:  { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  moveday:     { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  insertday:   { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  removeday:   { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  
  // Undo/redo - journalable and chatbot-executable
  undo:        { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  redo:        { journalable: true,  chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  
  // Non-journalable but chatbot-executable
  websearch:   { journalable: false, chatbotExecutable: true,  requiresChaining: true,  injectsUid: false, administrative: false },
  mark:        { journalable: false, chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  userpref:    { journalable: false, chatbotExecutable: true,  requiresChaining: false, injectsUid: false, administrative: false },
  
  // UI/system commands - not journalable, not chatbot-executable
  help:        { journalable: false, chatbotExecutable: false, requiresChaining: false, injectsUid: false, administrative: false },
  trip:        { journalable: false, chatbotExecutable: false, requiresChaining: false, injectsUid: false, administrative: false },
  model:       { journalable: false, chatbotExecutable: false, requiresChaining: false, injectsUid: false, administrative: false },
  
  // Administrative/maintenance commands
  renormalize: { journalable: false, chatbotExecutable: false, requiresChaining: false, injectsUid: false, administrative: true  },
  refreshcountries: { journalable: false, chatbotExecutable: false, requiresChaining: false, injectsUid: false, administrative: true  },
  
  // Meta commands (no execution, just parsed)
  intent:      { journalable: false, chatbotExecutable: false, requiresChaining: false, injectsUid: false, administrative: false },
};

/**
 * Get metadata for a command type
 */
export function getCommandMeta(commandType: string): CommandMeta | undefined {
  return COMMAND_METADATA[commandType];
}

/**
 * Check if a command type is journalable (modifies trip data)
 */
export function isJournalableCommand(commandType: string): boolean {
  return COMMAND_METADATA[commandType]?.journalable ?? false;
}

/**
 * Check if a command can be executed by the chatbot
 */
export function isChatbotExecutable(commandType: string): boolean {
  return COMMAND_METADATA[commandType]?.chatbotExecutable ?? false;
}

/**
 * Check if a command requires a follow-up GPT call after execution
 */
export function requiresChaining(commandType: string): boolean {
  return COMMAND_METADATA[commandType]?.requiresChaining ?? false;
}

/**
 * Check if a command gets a UID injected by the server
 */
export function injectsUid(commandType: string): boolean {
  return COMMAND_METADATA[commandType]?.injectsUid ?? false;
}

/**
 * Check if a command is administrative/maintenance
 */
export function isAdministrative(commandType: string): boolean {
  return COMMAND_METADATA[commandType]?.administrative ?? false;
}

/**
 * Get all command types that are journalable
 */
export function getJournalableCommandTypes(): string[] {
  return Object.entries(COMMAND_METADATA)
    .filter(([_, meta]) => meta.journalable)
    .map(([type, _]) => type);
}

/**
 * Get all command types that the chatbot can execute
 */
export function getChatbotExecutableCommandTypes(): string[] {
  return Object.entries(COMMAND_METADATA)
    .filter(([_, meta]) => meta.chatbotExecutable)
    .map(([type, _]) => type);
}
