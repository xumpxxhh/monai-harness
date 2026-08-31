import type { ModelPreviewChannel } from "@monai/ports";

export type ModelPreviewEvent =
  | {
      type: "preview_start";
      runId: string;
      stepId: string;
      modelCallId: string;
    }
  | {
      type: "delta";
      runId: string;
      stepId: string;
      modelCallId: string;
      channel: ModelPreviewChannel;
      text: string;
    }
  | {
      type: "preview_committed";
      runId: string;
      stepId: string;
      modelCallId: string;
      display: string;
    }
  | {
      type: "preview_invalid";
      runId: string;
      stepId: string;
      modelCallId: string;
      reason: string;
    };

export type PreviewListener = (event: ModelPreviewEvent) => void;

/**
 * In-process preview fan-out (token UX). Never persists; not Event Log.
 */
export class PreviewHub {
  private readonly listeners = new Map<string, Set<PreviewListener>>();
  private readonly globalListeners = new Set<PreviewListener>();

  publish(event: ModelPreviewEvent): void {
    for (const listener of this.globalListeners) {
      try {
        listener(event);
      } catch {
        // Preview must not break execution.
      }
    }
    const set = this.listeners.get(event.runId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Preview must not break execution.
      }
    }
  }

  subscribe(runId: string, listener: PreviewListener): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(runId);
    };
  }

  subscribeAll(listener: PreviewListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }
}
