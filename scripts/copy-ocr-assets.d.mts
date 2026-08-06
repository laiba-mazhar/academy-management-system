// Hand-written because the script is plain .mjs — Node runs it directly from an
// npm script, so it cannot be TypeScript, but vite.config.ts imports it and is
// type-checked.
export declare const OCR_ASSET_DIR: string
export declare function copyOcrAssets(): Promise<number>
