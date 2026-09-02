import crypto from "node:crypto";

import type {
  Action,
  ContextCompressionRecord,
  ContextSection,
  DialogueTurn,
  ModelMessage,
  ModelMessageToolCall,
} from "@monai/contracts";

import { getToolCallInvocations } from "../model/normalize-action.js";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function turnToToolCalls(turn: DialogueTurn): ModelMessageToolCall[] | undefined {
  if (!turn.toolCalls?.length) return undefined;
  return turn.toolCalls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments ?? {}),
    },
  }));
}

function dialogueTurnToMessage(turn: DialogueTurn): ModelMessage {
  if (turn.role === "tool") {
    return {
      role: "tool",
      content: turn.content ?? "",
      toolCallId: turn.toolCallId,
      name: turn.toolName,
    };
  }

  if (turn.role === "assistant") {
    const toolCalls = turnToToolCalls(turn);
    return {
      role: "assistant",
      content: turn.content,
      ...(toolCalls?.length ? { toolCalls } : {}),
    };
  }

  return {
    role: "user",
    content: turn.content ?? "",
  };
}

function staticSectionsPrefix(sections: readonly ContextSection[]): string | undefined {
  const staticKinds = new Set(["safety_boundary", "skills", "knowledge", "memory"]);
  const blocks = sections
    .filter((section) => staticKinds.has(section.kind) && section.text)
    .map((section) => `[${section.kind}]\n${section.text}`);
  if (blocks.length === 0) return undefined;
  return blocks.join("\n\n");
}

export type ProjectModelMessagesInput = {
  systemPrompt: string;
  sections: readonly ContextSection[];
  recentTurns: readonly DialogueTurn[];
  compression?: ContextCompressionRecord;
};

export type ProjectModelMessagesResult = {
  messages: ModelMessage[];
  messagesHash: string;
};

/**
 * Assemble ModelMessage[] for adapter wire format.
 */
export function projectModelMessages(input: ProjectModelMessagesInput): ProjectModelMessagesResult {
  const messages: ModelMessage[] = [];

  const staticPrefix = staticSectionsPrefix(input.sections);
  const systemContent = staticPrefix
    ? `${input.systemPrompt}\n\n${staticPrefix}`
    : input.systemPrompt;
  messages.push({ role: "system", content: systemContent });

  if (input.compression?.summaryText) {
    messages.push({
      role: "user",
      content: `Session/Run history summary:\n${input.compression.summaryText}`,
    });
  }

  for (const turn of input.recentTurns) {
    messages.push(dialogueTurnToMessage(turn));
  }

  const messagesHash = sha256(JSON.stringify(messages));
  return { messages, messagesHash };
}

function controlCallName(action: Action): string | undefined {
  switch (action.type) {
    case "ask_user":
      return "ask_user";
    case "finish":
      return "finish";
    case "noop":
      return "noop";
    case "spawn_child":
      return "spawn_child";
    default:
      return undefined;
  }
}

function controlArguments(action: Action): unknown {
  switch (action.type) {
    case "ask_user":
      return { prompt: action.displayText ?? "" };
    case "finish":
      return { summary: action.displayText ?? "" };
    case "noop":
      return {};
    case "spawn_child":
      return action.childSpec ?? {};
    default:
      return {};
  }
}

/** Map a hydrated Action to the assistant ModelMessage for context archives. */
export function assistantMessageFromAction(action: Action, displayText?: string): ModelMessage {
  const content = displayText?.trim() || action.displayText?.trim();

  if (action.type === "tool.call") {
    const toolCalls = getToolCallInvocations(action).map((inv, index) => ({
      id: `call-${index}`,
      type: "function" as const,
      function: {
        name: inv.toolId,
        arguments: JSON.stringify(inv.arguments ?? {}),
      },
    }));
    return {
      role: "assistant",
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  const controlName = controlCallName(action);
  if (controlName && controlName !== "finish") {
    return {
      role: "assistant",
      content,
      toolCalls: [
        {
          id: `ctrl-${action.actionId}`,
          type: "function",
          function: {
            name: controlName,
            arguments: JSON.stringify(controlArguments(action)),
          },
        },
      ],
    };
  }

  return { role: "assistant", content };
}
