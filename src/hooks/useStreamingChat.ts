import { useState, useRef } from "react";
import type { ChatMessage, ChatFilters } from "@/types/chat";
import { ToolCallState } from "@/components/ToolCallGraph";

export interface UseStreamingChatOptions {
  onError?: (error: Error) => void;
}

export interface UseStreamingChatReturn {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isLoading: boolean;
  sendMessage: (
    content: string,
    model: string,
    conversationHistory: ChatMessage[],
    filters?: ChatFilters
  ) => Promise<void>;
  currentAssistantMessageRef: React.MutableRefObject<ChatMessage | null>;
}

/**
 * Custom hook for handling streaming chat messages
 */
export function useStreamingChat(
  options?: UseStreamingChatOptions
): UseStreamingChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const currentAssistantMessageRef = useRef<ChatMessage | null>(null);

  const sendMessage = async (
    content: string,
    model: string,
    conversationHistory: ChatMessage[],
    filters?: ChatFilters
  ) => {
    if (!content.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: content.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    currentAssistantMessageRef.current = null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...conversationHistory, userMessage],
          model,
          filters: filters
            ? {
                customer: filters.customer,
                assignedTo: filters.assignedTo,
                priority: filters.priority,
                dateRange: filters.dateRange
                  ? {
                      ...(filters.dateRange.startDate && {
                        startDate: filters.dateRange.startDate.toISOString(),
                      }),
                      ...(filters.dateRange.endDate && {
                        endDate: filters.dateRange.endDate.toISOString(),
                      }),
                    }
                  : undefined,
              }
            : undefined,
        }),
      });

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      // Add initial assistant message
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: "",
        toolCalls: [],
      };
      currentAssistantMessageRef.current = assistantMessage;
      setMessages((prev) => [...prev, assistantMessage]);

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex;
        while ((boundaryIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);

          const lines = rawEvent.split("\n");
          let eventType = "";
          let payload = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              payload = line.slice(5).trim();
            }
          }

          if (!payload) continue;
          if (payload === "[DONE]") {
            buffer = "";
            break;
          }

          try {
            const json = JSON.parse(payload);

            if (eventType === "tool_call" || eventType === "tool_result") {
              if (!currentAssistantMessageRef.current?.toolCalls) {
                currentAssistantMessageRef.current.toolCalls = [];
              }

              const toolCall: ToolCallState = {
                tool: json.tool || "unknown",
                status: json.status || "running",
                attempt: json.attempt,
                maxAttempts: json.maxAttempts,
                result: json,
                timestamp: Date.now(),
              };

              const existingIndex =
                currentAssistantMessageRef.current.toolCalls.findIndex(
                  (tc) =>
                    tc.tool === toolCall.tool && tc.attempt === toolCall.attempt
                );

              if (existingIndex >= 0) {
                currentAssistantMessageRef.current.toolCalls[existingIndex] =
                  toolCall;
              } else {
                currentAssistantMessageRef.current.toolCalls.push(toolCall);
              }

              setMessages((prev) => [...prev]);
              continue;
            }

            if (eventType === "agent_response") {
              if (json.status === "using_regular_chat") {
                continue;
              }

              // Handle agent_response with content field (streaming tokens or complete answer)
              if (json.data?.content) {
                const content = json.data.content;
                const isStreaming = json.data.isStreaming !== false; // Default to true if not specified
                
                if (!currentAssistantMessageRef.current) {
                  currentAssistantMessageRef.current = {
                    role: "assistant",
                    content: content,
                    toolCalls: [],
                  };
                  setMessages((prev) => [
                    ...prev,
                    currentAssistantMessageRef.current!,
                  ]);
                } else {
                  if (isStreaming) {
                    // Accumulate streaming tokens
                    currentAssistantMessageRef.current.content += content;
                  } else {
                    // Complete answer - replace content
                    // Only replace if content is different to avoid duplicate processing
                    if (currentAssistantMessageRef.current.content !== content) {
                      currentAssistantMessageRef.current.content = content;
                    }
                  }
                  setMessages((prev) => [...prev]);
                }
                continue;
              }
            }

            // Handle legacy format (token streaming)
            const token = json?.choices?.[0]?.delta?.content ?? "";
            if (token && currentAssistantMessageRef.current) {
              currentAssistantMessageRef.current.content += token;
              setMessages((prev) => [...prev]);
              continue;
            }

            // Handle legacy format with isComplete (complete answer)
            if (json.isComplete && json?.choices?.[0]?.delta?.content) {
              const completeAnswer = json.choices[0].delta.content;
              if (!currentAssistantMessageRef.current) {
                currentAssistantMessageRef.current = {
                  role: "assistant",
                  content: completeAnswer,
                  toolCalls: [],
                };
                setMessages((prev) => [
                  ...prev,
                  currentAssistantMessageRef.current!,
                ]);
              } else {
                // Only update if content is different to avoid duplicate processing
                if (currentAssistantMessageRef.current.content !== completeAnswer) {
                  currentAssistantMessageRef.current.content = completeAnswer;
                  setMessages((prev) => [...prev]);
                }
              }
              continue;
            }
          } catch (error) {
            console.error("Error parsing SSE data:", error);
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage =
        error instanceof Error ? error : new Error("Unknown error");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error." },
      ]);

      if (options?.onError) {
        options.onError(
          errorMessage instanceof Error
            ? errorMessage
            : new Error(String(errorMessage))
        );
      }
    } finally {
      setIsLoading(false);
      currentAssistantMessageRef.current = null;
    }
  };

  return {
    messages,
    setMessages,
    isLoading,
    sendMessage,
    currentAssistantMessageRef,
  };
}
