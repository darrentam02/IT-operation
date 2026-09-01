declare module "pdf-parse" {
  export class PDFParse {
    constructor(options: { data: Buffer | Uint8Array; verbosity?: number });
    getText(): Promise<{ text: string; pages: unknown[] }>;
    getInfo(): Promise<Record<string, unknown>>;
    destroy(): void;
  }
}
