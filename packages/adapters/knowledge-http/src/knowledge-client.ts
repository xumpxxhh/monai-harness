export type KnowledgeSearchHit = {
  rank: number;
  collectionId: string;
  sourceId: string;
  title: string;
  content: string;
  score: number;
  scoreKind?: "retriever" | "rrf" | "llm" | string;
};

export type KnowledgeSearchGrounding = {
  empty: boolean;
  chunksEmptyReason?: "no-hits" | "filtered" | "skipped";
};

export type KnowledgeSearchResult = {
  query: string;
  effectiveQuery?: string;
  traceId: string;
  hits: KnowledgeSearchHit[];
  grounding: KnowledgeSearchGrounding;
};

export type KnowledgeSearchInput = {
  query: string;
  collectionIds?: readonly string[];
  topK?: number;
};

/** Pack Tool `knowledge.search` calls this via ExecutionContext.ports.knowledge */
export type KnowledgeSearchClient = {
  search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult>;
};

export type KnowledgeSearchErrorBody = {
  message?: string;
  code?: string;
};

export class KnowledgeSearchHttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "KnowledgeSearchHttpError";
    this.status = status;
    this.code = code;
  }
}

export type HttpKnowledgeSearchClientOptions = {
  /** e.g. http://localhost:3001 — `/api/v1/search` is appended when missing */
  baseUrl: string;
  timeoutMs?: number;
  /** Default collectionIds when the model omits collection_ids */
  defaultCollectionIds?: readonly string[];
  defaultTopK?: number;
  fetchImpl?: typeof fetch;
};

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed.endsWith("/api/v1")) return trimmed;
  return `${trimmed}/api/v1`;
}

function resolveSearchUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return `${normalized}/search`;
}

export class HttpKnowledgeSearchClient implements KnowledgeSearchClient {
  private readonly searchUrl: string;
  private readonly timeoutMs: number;
  private readonly defaultCollectionIds: readonly string[];
  private readonly defaultTopK?: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpKnowledgeSearchClientOptions) {
    this.searchUrl = resolveSearchUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.defaultCollectionIds = options.defaultCollectionIds ?? [];
    this.defaultTopK = options.defaultTopK;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
    const query = input.query.trim();
    if (!query) {
      throw new KnowledgeSearchHttpError(400, "query is required", "bad_request");
    }

    const collectionIds =
      input.collectionIds && input.collectionIds.length > 0
        ? [...input.collectionIds]
        : this.defaultCollectionIds.length > 0
          ? [...this.defaultCollectionIds]
          : undefined;

    const body: Record<string, unknown> = { query };
    if (collectionIds?.length) body.collectionIds = collectionIds;
    const topK = input.topK ?? this.defaultTopK;
    if (topK !== undefined) body.topK = topK;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(this.searchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        throw new KnowledgeSearchHttpError(
          res.status,
          `invalid JSON from knowledge search: ${text.slice(0, 200)}`,
          "bad_response",
        );
      }

      if (!res.ok) {
        const errBody = parsed as KnowledgeSearchErrorBody;
        throw new KnowledgeSearchHttpError(
          res.status,
          errBody.message ?? `knowledge search failed: ${res.status}`,
          errBody.code,
        );
      }

      return normalizeSearchResult(parsed as Record<string, unknown>, query);
    } catch (err) {
      if (err instanceof KnowledgeSearchHttpError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new KnowledgeSearchHttpError(504, "knowledge search timed out", "timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeSearchResult(raw: Record<string, unknown>, fallbackQuery: string): KnowledgeSearchResult {
  const hitsRaw = Array.isArray(raw.hits) ? raw.hits : [];
  const hits: KnowledgeSearchHit[] = hitsRaw.map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      rank: typeof row.rank === "number" ? row.rank : index + 1,
      collectionId: String(row.collectionId ?? ""),
      sourceId: String(row.sourceId ?? ""),
      title: String(row.title ?? row.sourceId ?? ""),
      content: String(row.content ?? ""),
      score: typeof row.score === "number" ? row.score : 0,
      scoreKind: row.scoreKind !== undefined ? String(row.scoreKind) : undefined,
    };
  });

  const groundingRaw = (raw.grounding ?? {}) as Record<string, unknown>;
  const grounding: KnowledgeSearchGrounding = {
    empty: Boolean(groundingRaw.empty),
    chunksEmptyReason:
      groundingRaw.chunksEmptyReason === "no-hits" ||
      groundingRaw.chunksEmptyReason === "filtered" ||
      groundingRaw.chunksEmptyReason === "skipped"
        ? groundingRaw.chunksEmptyReason
        : undefined,
  };

  const effectiveQuery =
    typeof raw.effectiveQuery === "string" && raw.effectiveQuery !== raw.query
      ? raw.effectiveQuery
      : undefined;

  return {
    query: typeof raw.query === "string" ? raw.query : fallbackQuery,
    effectiveQuery,
    traceId: typeof raw.traceId === "string" ? raw.traceId : "",
    hits,
    grounding,
  };
}
