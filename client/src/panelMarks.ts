class PanelMarks {
  private marked = new Set<string>();
  private listeners = new Set<(ids: string[]) => void>();

  mark(id: string | null | undefined): void {
    if (!id) {
      return;
    }
    const beforeSize = this.marked.size;
    this.marked.add(id);
    if (this.marked.size !== beforeSize) {
      this.emitChange();
    }
  }

  unmark(id: string | null | undefined): void {
    if (!id) {
      return;
    }
    const removed = this.marked.delete(id);
    if (removed) {
      this.emitChange();
    }
  }

  /**
   * Replace all marks with a new set. Used when syncing from server.
   */
  setAll(ids: string[]): void {
    const newSet = new Set(ids.filter(Boolean));
    const sameSize = newSet.size === this.marked.size;
    const sameContents = sameSize && [...newSet].every(id => this.marked.has(id));
    if (!sameContents) {
      this.marked = newSet;
      this.emitChange();
    }
  }

  getMarked(): string[] {
    return Array.from(this.marked.values());
  }

  subscribe(listener: (ids: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange() {
    const snapshot = this.getMarked();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

// Activity marks (by UID)
export const panelMarks = new PanelMarks();

// Date marks (by YYYY-MM-DD)
export const panelDateMarks = new PanelMarks();
