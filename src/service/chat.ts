import OpenAI from "openai";
import type { ChatMessage } from "@/types/chat";

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
  max_tokens?: number;
}

/**
 * Validates and transforms messages to OpenAI format
 */
function validateAndTransformMessages(
  messages: ChatMessage[]
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  if (!Array.isArray(messages)) {
    throw new Error("Messages must be an array");
  }

  if (messages.length === 0) {
    throw new Error("Messages array cannot be empty");
  }

  return messages.map((m) => {
    let role: "system" | "user" | "assistant" = "user";
    if (m.role === "assistant" || m.role === "agent") {
      role = "assistant";
    } else if (m.role === "system") {
      role = "system";
    }
    return {
      role,
      content: m.content,
    };
  });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Performs a non-streaming chat completion request
 */
export async function chatCompletion(
  options: ChatCompletionOptions
): Promise<any> {
  const { messages = [], model = "gpt-4o", max_tokens } = options;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const combinedMessages = validateAndTransformMessages(messages);

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: combinedMessages,
      max_tokens,
    });

    return response;
  } catch (error: any) {
    console.error("OpenAI API error:", error);
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

/**
 * Performs a streaming chat completion request
 */
export async function streamChatCompletion(
  options: ChatCompletionOptions
): Promise<ReadableStream> {
  const { messages = [], model = "gpt-4o", max_tokens } = options;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const combinedMessages = validateAndTransformMessages(messages);

  try {
    const stream = await openai.chat.completions.create({
      model,
      messages: combinedMessages,
      max_tokens,
      stream: true,
    });

    const encoder = new TextEncoder();

    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              const data = JSON.stringify({
                choices: [
                  {
                    delta: {
                      content,
                      role: "assistant",
                    },
                  },
                ],
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          console.error("Streaming error:", err);
          controller.error(err);
        }
      },
    });
  } catch (error: any) {
    console.error("OpenAI streaming error:", error);
    throw new Error(`OpenAI streaming error: ${error.message}`);
  }
}
