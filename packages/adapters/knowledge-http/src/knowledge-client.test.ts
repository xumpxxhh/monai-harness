import { describe, expect, it, vi } from "vitest";
import {
  HttpKnowledgeSearchClient,
  KnowledgeSearchHttpError,
} from "./knowledge-client.js";

describe("HttpKnowledgeSearchClient", () => {
  it("maps query, collectionIds, topK to POST /api/v1/search", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("http://localhost:3001/api/v1/search");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        "Content-Type": "application/json; charset=utf-8",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        query: "什么是知识库？",
        collectionIds: ["kb-abc"],
        topK: 5,
      });
      return new Response(
        JSON.stringify({
          query: "什么是知识库？",
          traceId: "trace-1",
          hits: [
            {
              rank: 1,
              collectionId: "kb-abc",
              sourceId: "intro.md",
              title: "RAG 入门",
              content: "知识库是……",
              score: 0.12,
              scoreKind: "rrf",
            },
          ],
          grounding: { empty: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = new HttpKnowledgeSearchClient({
      baseUrl: "http://localhost:3001",
      fetchImpl,
    });

    const result = await client.search({
      query: "什么是知识库？",
      collectionIds: ["kb-abc"],
      topK: 5,
    });

    expect(result.traceId).toBe("trace-1");
    expect(result.hits[0]?.sourceId).toBe("intro.md");
    expect(result.grounding.empty).toBe(false);
  });

  it("uses defaultCollectionIds when model omits collection_ids", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        query: "test",
        collectionIds: ["kb-default"],
        topK: 8,
      });
      return new Response(
        JSON.stringify({
          query: "test",
          traceId: "t2",
          hits: [],
          grounding: { empty: true, chunksEmptyReason: "no-hits" },
        }),
        { status: 200 },
      );
    });

    const client = new HttpKnowledgeSearchClient({
      baseUrl: "http://localhost:3001/api/v1",
      defaultCollectionIds: ["kb-default"],
      defaultTopK: 8,
      fetchImpl,
    });

    const result = await client.search({ query: "test" });
    expect(result.grounding.empty).toBe(true);
    expect(result.grounding.chunksEmptyReason).toBe("no-hits");
  });

  it("throws KnowledgeSearchHttpError on HTTP 404", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: "collection not found", code: "not_found" }), {
        status: 404,
      }),
    );

    const client = new HttpKnowledgeSearchClient({
      baseUrl: "http://localhost:3001",
      fetchImpl,
    });

    await expect(client.search({ query: "missing" })).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      message: "collection not found",
    } satisfies Partial<KnowledgeSearchHttpError>);
  });

  it("rejects empty query before network", async () => {
    const fetchImpl = vi.fn();
    const client = new HttpKnowledgeSearchClient({
      baseUrl: "http://localhost:3001",
      fetchImpl,
    });

    await expect(client.search({ query: "  " })).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
