import type { WorkspacePort } from "@monai/ports";

/**
 * In-memory WorkspacePort with a single authorized root `/`.
 * Rejects `..` traversal and absolute drive-style escapes.
 */
export class InMemoryWorkspace implements WorkspacePort {
  private readonly files = new Map<string, string>();

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [path, content] of Object.entries(initial)) {
        this.files.set(this.normalize(path), content);
      }
    }
  }

  async list(path: string): Promise<unknown[]> {
    const root = this.normalize(path);
    const prefix = root.endsWith("/") ? root : `${root}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key === root) continue;
      if (!key.startsWith(prefix) && root !== "/") continue;
      if (root === "/" && !key.startsWith("/")) continue;
      const rest = root === "/" ? key.slice(1) : key.slice(prefix.length);
      const seg = rest.split("/")[0];
      if (seg) names.add(seg);
    }
    return [...names].sort().map((name) => ({ name, path: root === "/" ? `/${name}` : `${root}/${name}` }));
  }

  async read(path: string): Promise<unknown> {
    const key = this.normalize(path);
    const content = this.files.get(key);
    if (content === undefined) {
      throw new Error(`workspace path not found: ${key}`);
    }
    return { path: key, content };
  }

  async write(path: string, content: unknown): Promise<void> {
    const key = this.normalize(path);
    this.files.set(key, typeof content === "string" ? content : JSON.stringify(content));
  }

  async search(query: string): Promise<unknown[]> {
    const q = query.toLowerCase();
    const hits: unknown[] = [];
    for (const [path, content] of this.files.entries()) {
      if (path.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
        hits.push({ path, snippet: content.slice(0, 120) });
      }
    }
    return hits;
  }

  /** Test helper. */
  dump(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }

  private normalize(path: string): string {
    const raw = path.replace(/\\/g, "/").trim();
    if (!raw.startsWith("/")) {
      throw new Error("workspace path must be absolute under /");
    }
    if (raw.includes("\0")) {
      throw new Error("workspace path rejects NUL");
    }
    const parts: string[] = [];
    for (const seg of raw.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        throw new Error("workspace path rejects ..");
      }
      if (/^[a-zA-Z]:$/.test(seg)) {
        throw new Error("workspace path rejects drive segments");
      }
      parts.push(seg);
    }
    return `/${parts.join("/")}`;
  }
}

export const PACKAGE_NAME = "@monai/workspace-memory" as const;
