import { streamChatCompletion } from "./chat";
import {
  createAgentWithTools,
  executeAgentWithStreaming,
} from "./agent/langchain-agent";
import type { ChatMessage, ChatFilters } from "@/types/chat";

interface StreamEvent {
  type: "tool_call" | "tool_result" | "agent_response" | "error";
  data: any;
}

export async function streamAgentResponse(
  messages: ChatMessage[],
  model: string,
  max_tokens?: number,
  filters?: ChatFilters
): Promise<ReadableStream> {
  const userMessages = messages.filter((m) => m.role === "user");
  const userQuery = userMessages[userMessages.length - 1]?.content || "";

  if (!userQuery) {
    throw new Error("No user query found in messages");
  }

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: StreamEvent) => {
        const data = JSON.stringify(event.data);
        const message = `event: ${event.type}\ndata: ${data}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      const previousMessages = messages.slice(0, -1);
      const conversationContext =
        previousMessages.length > 0
          ? `\n\nCONVERSATION HISTORY:\n${previousMessages
              .map((msg) => {
                const role = msg.role === "user" ? "User" : "Assistant";
                return `${role}: ${msg.content}`;
              })
              .join(
                "\n"
              )}\n\nUse this conversation history to understand context and references from previous messages.`
          : undefined;

      try {
        const { agent } = await createAgentWithTools(
          model,
          max_tokens,
          filters
        );

        await executeAgentWithStreaming(
          agent,
          userQuery,
          (event) => {
            if (
              event.type === "tool_call" ||
              event.type === "tool_result" ||
              event.type === "error"
            ) {
              sendEvent(event);
            } else if (event.type === "agent_response" && event.data?.content) {
              // Only send in legacy format for frontend compatibility
              // The frontend expects the legacy format with choices array
              const chunkData = JSON.stringify({
                choices: [
                  {
                    delta: {
                      content: event.data.content,
                      role: "assistant",
                    },
                  },
                ],
                isComplete: event.data.isStreaming === false, // Only mark complete when streaming is done
              });
              const message = `data: ${chunkData}\n\n`;
              controller.enqueue(encoder.encode(message));
            }
          },
          conversationContext,
          filters
        );

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error: any) {
        console.error("Agent streaming error:", error);
        sendEvent({
          type: "error",
          data: {
            error: error.message,
            fallback: "Falling back to regular chat",
          },
        });

        try {
          const regularStream = await streamChatCompletion({
            messages,
            model,
            max_tokens,
          });

          const reader = regularStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (fallbackError: any) {
          console.error("Fallback chat error:", fallbackError);
          const errorMsg = JSON.stringify({
            choices: [
              {
                delta: {
                  content: `Error: ${fallbackError.message}`,
                },
              },
            ],
          });
          controller.enqueue(encoder.encode(`data: ${errorMsg}\n\n`));
        }

        controller.close();
      }
    },
  });
}
