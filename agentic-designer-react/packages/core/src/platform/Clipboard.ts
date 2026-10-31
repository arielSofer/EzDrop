// Platform adapter: NSPasteboard.

export interface Clipboard {
  readText(): Promise<string | null>;
  writeText(text: string): Promise<void>;
}

export class MemoryClipboard implements Clipboard {
  private text: string | null = null;
  async readText(): Promise<string | null> {
    return this.text;
  }
  async writeText(text: string): Promise<void> {
    this.text = text;
  }
}
