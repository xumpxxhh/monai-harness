import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { WorkspacePort } from "@monai/ports";

/**
 * Maps virtual workspace paths (`/foo/bar`) to a directory on disk.
 */
export class FsWorkspace implements WorkspacePort {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  getRootDir(): string {
    return this.rootDir;
  }

  async list(workspacePath: string): Promise<unknown[]> {
    const abs = this.resolveOnDisk(workspacePath);
    const st = await stat(abs);
    if (!st.isDirectory()) {
      throw new Error(`workspace path is not a directory: ${this.normalizeVirtual(workspacePath)}`);
    }

    const entries = await readdir(abs, { withFileTypes: true });
    const virtualRoot = this.normalizeVirtual(workspacePath);
    return entries
      .map((entry) => {
        const name = entry.name;
        const childVirtual =
          virtualRoot === "/" ? `/${name}` : `${virtualRoot}/${name}`;
        return { name, path: childVirtual, kind: entry.isDirectory() ? "directory" : "file" };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async read(workspacePath: string): Promise<unknown> {
    const virtual = this.normalizeVirtual(workspacePath);
    const abs = this.resolveOnDisk(virtual);
    const st = await stat(abs);
    if (!st.isFile()) {
      throw new Error(`workspace path is not a file: ${virtual}`);
    }
    const content = await readFile(abs, "utf8");
    return { path: virtual, content };
  }

  async write(workspacePath: string, content: unknown): Promise<void> {
    const virtual = this.normalizeVirtual(workspacePath);
    const abs = this.resolveOnDisk(virtual);
    await mkdir(path.dirname(abs), { recursive: true });
    const text = typeof content === "string" ? content : JSON.stringify(content ?? null);
    await writeFile(abs, text, "utf8");
  }

  async search(query: string): Promise<unknown[]> {
    const q = query.toLowerCase();
    const hits: unknown[] = [];
    await this.walk(this.rootDir, "/", async (virtual, abs, isFile) => {
      if (!isFile) return;
      const content = await readFile(abs, "utf8");
      if (virtual.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
        hits.push({ path: virtual, snippet: content.slice(0, 120) });
      }
    });
    return hits;
  }

  private async walk(
    absDir: string,
    virtualDir: string,
    visit: (virtual: string, abs: string, isFile: boolean) => Promise<void>,
  ): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(absDir, entry.name);
      const virtual =
        virtualDir === "/" ? `/${entry.name}` : `${virtualDir}/${entry.name}`;
      if (entry.isDirectory()) {
        await this.walk(abs, virtual, visit);
      } else if (entry.isFile()) {
        await visit(virtual, abs, true);
      }
    }
  }

  private resolveOnDisk(workspacePath: string): string {
    const virtual = this.normalizeVirtual(workspacePath);
    const relative = virtual === "/" ? "" : virtual.slice(1);
    const abs = path.resolve(this.rootDir, relative);
    const rootWithSep = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : `${this.rootDir}${path.sep}`;
    if (abs !== this.rootDir && !abs.startsWith(rootWithSep)) {
      throw new Error("workspace path escape rejected");
    }
    return abs;
  }

  private normalizeVirtual(workspacePath: string): string {
    const raw = workspacePath.replace(/\\/g, "/").trim();
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
    return parts.length === 0 ? "/" : `/${parts.join("/")}`;
  }
}
