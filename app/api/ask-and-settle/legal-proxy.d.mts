export function forwardLegalQuestion(body: unknown, url: string, fetchImpl?: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }>;
export function fetchLegalCorpus(url: string, fetchImpl?: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }>;
