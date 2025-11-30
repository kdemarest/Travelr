export interface ChatPiece {
  piece: string;
}

const NEWLINE_PATTERN = /\r\n|\r|\n/g;

export function parseChatPieces(payload: string): ChatPiece[] {
  if (!payload) {
    return [];
  }

  NEWLINE_PATTERN.lastIndex = 0;
  const pieces: ChatPiece[] = [];
  let pendingText = "";
  let cursor = 0;

  while (cursor <= payload.length) {
    const match = NEWLINE_PATTERN.exec(payload);
    const lineEnd = match ? match.index : payload.length;
    const lineContent = payload.slice(cursor, lineEnd);
    const newlineText = match ? match[0] : "";
    const normalizedLine = lineContent.trim();
    const isSlashCommand = normalizedLine.startsWith("/") && normalizedLine.length > 1;

    if (isSlashCommand) {
      if (pendingText.length) {
        pieces.push({ piece: pendingText });
        pendingText = "";
      }
      pieces.push({ piece: normalizedLine });
    } else {
      pendingText += lineContent + newlineText;
    }

    if (!match) {
      break;
    }

    cursor = lineEnd + newlineText.length;
  }

  if (pendingText.length) {
    pieces.push({ piece: pendingText });
  }

  return pieces;
}

export function isCommandPiece(value: ChatPiece): boolean {
  return value.piece.trimStart().startsWith("/");
}

export function isTextPiece(value: ChatPiece): boolean {
  return !isCommandPiece(value);
}

/**
 * Check if pieces contain any non-empty prose (non-command text).
 * Used to determine if chatbot should be called.
 */
export function hasProse(pieces: ChatPiece[]): boolean {
  return pieces.some(p => isTextPiece(p) && p.piece.trim().length > 0);
}
