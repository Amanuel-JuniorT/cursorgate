export const PROTOCOL_VERSION: number;
export const MSG: Record<string, string>;
export function envelope(type: string, payload?: object): object;
export function redactSecrets(text: string): string;
export const DEFAULT_ALLOWLIST: string[];
export const CHAINING_RE: RegExp;
