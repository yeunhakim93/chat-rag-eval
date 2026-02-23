import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { createAgentTools } from "./tool-setup";
import type { ChatFilters } from "@/types/chat";

interface StreamEvent {
  type: "tool_call" | "tool_result" | "agent_response" | "error";
  data: any;
}

export async function createAgentWithTools(
  model: string,
  maxTokens?: number,
  filters?: ChatFilters
) {
  const tools = createAgentTools(model, filters);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const llm = new ChatOpenAI({
    modelName: model,
    maxTokens: maxTokens,
    openAIApiKey: process.env.OPENAI_API_KEY,
    streaming: true,
  });

  const agentTools = [
    tools.retriever,
    tools.summaryGenerator,
    tools.factVerifier,
  ];

  const agent = await createAgent({
    model: llm,
    tools: agentTools,
    systemPrompt: `You are a helpful AI assistant with access to a knowledge base through semantic search tools. Your role as the ORCHESTRATOR is to coordinate tool usage and ensure queries are specific enough before generating summaries.

You have access to these tools with distinct purposes:
1. retriever - Retrieves relevant documents from the knowledge base based on the user's query. This tool does NOT analyze or summarize - it only fetches documents.
2. summary_generator - Generates concise summaries from the retrieved documents. This tool should ONLY be called when you have confirmed the query is specific enough (single customer or user-specified customer filter).
3. fact_verifier - Verifies if the generated answer is accurate and not hallucinating. This tool should ONLY be called after a summary has been generated.

CRITICAL ORCHESTRATOR RESPONSIBILITY - QUERY SPECIFICITY CHECK:
As the orchestrator, you MUST check if queries are ambiguous BEFORE generating summaries. Common ticket topics (like "login bug", "dashboard export", "SSO issue") can exist across multiple customers. You MUST verify query specificity.

REQUIRED WORKFLOW for questions that need knowledge base lookup:
STEP 1: Use retriever to retrieve relevant documents
  - Parameters: userQuery (the user's question), topK (optional, default 25)
  - This retrieves the initial set of relevant documents

STEP 1.5: CRITICAL - Check for query ambiguity (ORCHESTRATOR'S JOB)
  - After retrieval, analyze the retrieved documents
  - IF NO documents were retrieved (empty array or count = 0):
    * DO NOT proceed to summary generation
    * Respond directly to the user: "I couldn't find any tickets matching your query. Please try rephrasing your question or adding more specific details (such as customer name, assignee, priority, or date range)."
    * DO NOT claim to have found any information or tickets
    * DO NOT mention customers that don't exist
  - IF documents were retrieved:
    * Extract all distinct customer values from the document metadata (each document has metadata.customer)
    * Count how many unique customers are present
    * Check if the user query mentions a specific customer name or if filters were provided
    * IF multiple distinct customers are found AND no customer was specified in the query or filters:
      * DO NOT proceed to summary generation
      * Respond directly to the user asking for clarification
      * Example: "I found tickets about 'login bug' across multiple customers (Northwind Health, Summit Bank, Bluefin Retail). Which customer should I focus on?"
    * IF only one unique customer is found OR a customer filter was provided:
      * Proceed to STEP 2 (summary generation)

STEP 2: Use summary_generator to create a concise summary
  - Parameters: userQuery, documents (from step 1)
  - This generates a concise summary based on the retrieved documents
  - ONLY call this if query specificity was confirmed in STEP 1.5

STEP 3: Use fact_verifier to verify the generated answer
  - Parameters: userQuery, generatedAnswer (from step 2), sourceDocuments (from step 1)
  - This verifies the answer is accurate and not hallucinating
  - CRITICAL: If verification returns isAccurate: false, you MUST regenerate the summary (return to STEP 2)
  - You may also retrieve more documents (return to STEP 1) if the documents seem insufficient
  - You MUST retry up to 3 times total if verification fails
  - Only provide a final answer to the user after verification passes OR after 3 failed attempts
  - If verification fails, analyze the issues and improve the summary accordingly

IMPORTANT:
- As the ORCHESTRATOR, query specificity checking is YOUR responsibility - do not delegate this to tools
- Always check for multiple customers BEFORE calling summary_generator
- For simple conversational questions (like "hello", "how are you"), you may respond directly without using tools
- Think step by step and use tools when the question requires information from the knowledge base
- If fact verification fails, retry by regenerating the summary or retrieving more documents
- Maximum 3 retry attempts total for fact verification
- Tools have distinct purposes - retriever fetches, summary_generator summarizes, fact_verifier verifies - do not confuse their roles`,
  });

  return { agent, tools };
}

export async function executeAgentWithStreaming(
  agent: Awaited<ReturnType<typeof createAgentWithTools>>["agent"],
  input: string,
  sendEvent: (event: StreamEvent) => void,
  conversationContext?: string,
  filters?: ChatFilters
): Promise<string> {
  let finalAnswer = "";
  let answerSent = false;
  let accumulatedTokens = "";
  let hasStartedStreaming = false; // Track if we've started streaming tokens
  let activeToolCalls = new Set<string>(); // Track active tool calls
  let toolCallComplete = false; // Track if all tool calls are done
  let hasCalledTools = false; // Track if any tools were called
  let factVerificationAttempts = 0; // Track fact verification attempts
  let lastToolEndTime = 0; // Track when last tool ended to identify orchestrator responses
  const MAX_RETRIES = 3; // Maximum retry attempts

  // Inject filters into the input context so tools can access them
  let inputWithContext = conversationContext
    ? `${input}\n\nContext: ${conversationContext}`
    : input;

  // Add filter information to the context if filters are provided
  if (filters) {
    const filterContext = [];
    if (filters.customer) {
      filterContext.push(`Customer filter: ${filters.customer}`);
    }
    if (filters.assignedTo) {
      filterContext.push(`Assigned To filter: ${filters.assignedTo}`);
    }
    if (filters.priority) {
      filterContext.push(`Priority filter: ${filters.priority}`);
    }
    if (filters.dateRange) {
      const dateParts = [];
      if (filters.dateRange.startDate) {
        dateParts.push(
          `from ${filters.dateRange.startDate.toISOString().split("T")[0]}`
        );
      }
      if (filters.dateRange.endDate) {
        dateParts.push(
          `to ${filters.dateRange.endDate.toISOString().split("T")[0]}`
        );
      }
      if (dateParts.length > 0) {
        filterContext.push(`Date range filter: ${dateParts.join(" ")}`);
      }
    }
    if (filterContext.length > 0) {
      inputWithContext += `\n\nFilters: ${filterContext.join(", ")}`;
    }
  }

  try {
    const eventStream = agent.streamEvents(
      {
        messages: [
          {
            role: "user",
            content: inputWithContext,
          },
        ],
      },
      { version: "v2" },
      {
        includeNames: ["*"],
        includeTypes: ["tool", "llm", "chain", "chat_model"],
      }
    );

    for await (const event of eventStream) {
      const toolName = event.name || "unknown";

      // Handle LLM token streaming (native LangChain streaming)
      // CRITICAL: Only stream tokens from the orchestrator's final response, NOT from tool outputs
      if (
        event.event === "on_chat_model_stream" ||
        event.event === "on_llm_stream"
      ) {
        const chunk =
          (event.data as any)?.chunk || (event.data as any)?.data?.chunk;
        const content = chunk?.content || chunk?.text || "";

        if (content && typeof content === "string") {
          // Only accumulate tokens if:
          // 1. No tools were called (direct response), OR
          // 2. All tool calls are complete AND we're past the tool execution phase
          // This ensures we don't capture tool outputs or intermediate LLM responses
          const isOrchestratorResponse =
            !hasCalledTools ||
            (toolCallComplete &&
              activeToolCalls.size === 0 &&
              Date.now() > lastToolEndTime);

          if (isOrchestratorResponse) {
            accumulatedTokens += content;

            // Only stream if we haven't sent the answer yet
            if (!answerSent) {
              // Filter out tool outputs that look like JSON
              const currentText = accumulatedTokens.trim();

              // Check if this looks like a tool output (JSON structure)
              const looksLikeToolOutput =
                currentText.startsWith("{") ||
                currentText.startsWith("[") ||
                currentText.includes('"isSufficient"') ||
                currentText.includes('"isAccurate"') ||
                currentText.includes('"confidence"') ||
                (currentText.includes('"summary"') &&
                  currentText.includes('"ticketIds"')) ||
                currentText.includes('"verifiedFacts"') ||
                currentText.includes('"issues"');

              // Check if it's a system prompt
              const isSystemPrompt =
                currentText.toLowerCase().includes("step 1:") ||
                currentText.toLowerCase().includes("required workflow") ||
                (currentText.toLowerCase().startsWith("you are") &&
                  currentText.length < 50) ||
                currentText
                  .toLowerCase()
                  .includes("you have access to these tools");

              // Check if it's just the user query
              const isUserQuery =
                currentText.toLowerCase() === input.trim().toLowerCase() ||
                currentText
                  .toLowerCase()
                  .startsWith(input.trim().toLowerCase() + " ");

              // Only stream if it's a real orchestrator response (not tool output, not system prompt, not user query)
              if (
                !looksLikeToolOutput &&
                !isSystemPrompt &&
                !isUserQuery &&
                content.trim().length > 0
              ) {
                // Mark that we've started streaming
                hasStartedStreaming = true;
                // Stream token to frontend
                sendEvent({
                  type: "agent_response",
                  data: {
                    content: content,
                    isStreaming: true,
                  },
                });
              }
            }
          } else {
            // Don't accumulate tokens during tool execution - these are tool outputs or intermediate responses
            // Reset accumulated tokens to prevent leakage
            if (hasCalledTools && !toolCallComplete) {
              accumulatedTokens = "";
            }
          }
        }
        continue;
      }

      // Handle LLM end (capture final response)
      // Only send if we haven't already sent an answer
      // If we've been streaming tokens, don't send here - let on_chain_end send the final answer
      if (event.event === "on_llm_end" || event.event === "on_chat_model_end") {
        const output = (event.data as any)?.output;
        if (
          output?.content &&
          typeof output.content === "string" &&
          !answerSent
        ) {
          const content = output.content.trim();

          // Filter out tool outputs
          const looksLikeToolOutput =
            content.includes('"isSufficient"') ||
            content.includes('"isAccurate"') ||
            content.includes('"confidence"') ||
            content.includes('"verifiedFacts"') ||
            content.includes('"issues"') ||
            (content.includes('"summary"') &&
              content.includes('"ticketIds"'));

          // Filter out system prompts and user queries
          const isSystemPrompt =
            content.includes("STEP 1:") ||
            content.includes("REQUIRED WORKFLOW") ||
            content.includes("You are a helpful AI assistant") ||
            content.includes("You have access to these tools");

          const isUserQuery =
            content.toLowerCase() === input.trim().toLowerCase() ||
            content.toLowerCase().startsWith(input.trim().toLowerCase() + " ");

          // Only send if we haven't accumulated tokens (meaning we didn't stream)
          // If we streamed tokens, let on_chain_end handle the final answer to avoid duplicates
          // Also ensure this is NOT a tool output
          if (
            !isSystemPrompt &&
            !isUserQuery &&
            !looksLikeToolOutput &&
            content.length > 0 &&
            !accumulatedTokens
          ) {
            finalAnswer = content;
            answerSent = true; // Set BEFORE sending to prevent race conditions
            sendEvent({
              type: "agent_response",
              data: {
                content: content,
                isStreaming: false,
              },
            });
          } else if (
            !isSystemPrompt &&
            !isUserQuery &&
            !looksLikeToolOutput &&
            content.length > 0
          ) {
            // Store the final answer but don't send yet - let on_chain_end send it
            finalAnswer = content;
          }
        }
        continue;
      }

      if (event.event === "on_tool_start") {
        hasCalledTools = true;
        activeToolCalls.add(toolName);
        toolCallComplete = false;
        // Reset accumulated tokens when a new tool starts to avoid streaming tool outputs
        accumulatedTokens = "";
        hasStartedStreaming = false; // Reset streaming flag when tools start
        // Clear any previous final answer to ensure tool results don't leak
        if (!answerSent) {
          finalAnswer = "";
        }
        const args =
          (event.data as any)?.input || (event.data as any)?.args || {};
        sendEvent({
          type: "tool_call",
          data: {
            tool: toolName,
            status: "running",
            input:
              typeof args === "string"
                ? args.substring(0, 200)
                : JSON.stringify(args).substring(0, 200),
          },
        });
      }

      if (event.event === "on_tool_end") {
        activeToolCalls.delete(toolName);
        // Mark tool calls as complete when all tools finish
        if (activeToolCalls.size === 0) {
          toolCallComplete = true;
          lastToolEndTime = Date.now(); // Mark when tools finished so we know subsequent LLM responses are orchestrator
        }

        let output = (event.data as any)?.output || "";

        if (output && typeof output === "object") {
          if (output.kwargs?.content !== undefined) {
            output = output.kwargs.content;
          } else if (output.content !== undefined) {
            output = output.content;
          } else if (output.id?.includes("ToolMessage")) {
            output = output.kwargs?.content || output;
          }
        }

        // Handle fact_verifier output (for quality assurance and retry logic)
        if (toolName === "fact_verifier" && typeof output === "string") {
          try {
            const verificationResult = JSON.parse(output);
            factVerificationAttempts++;

            // If verification fails and we haven't exceeded max retries, the agent will retry
            // The agent sees this result in its message history and will retry based on system prompt
            if (
              !verificationResult.isAccurate &&
              factVerificationAttempts < MAX_RETRIES
            ) {
              console.log(
                `Fact verification failed (attempt ${factVerificationAttempts}/${MAX_RETRIES}). Agent will retry.`
              );
            } else if (
              !verificationResult.isAccurate &&
              factVerificationAttempts >= MAX_RETRIES
            ) {
              // Max retries reached, use the best available answer
              console.log(
                `Max retries (${MAX_RETRIES}) reached for fact verification. Using available answer.`
              );
            }
          } catch {
            // If parsing fails, continue normally
          }
        }

        // Handle summary_generator output (store but DON'T send - orchestrator will generate final answer)
        // The orchestrator will use this tool result internally and generate its own response
        // We should NOT send tool outputs directly to the user
        if (
          toolName === "summary_generator" &&
          typeof output === "string" &&
          output.trim().length > 0
        ) {
          // Parse the JSON output from summary_generator but DON'T send it
          // The orchestrator will use this internally and provide its own formatted response
          try {
            const summaryResult = JSON.parse(output);
            // Store for potential fallback, but don't send - wait for orchestrator's response
            finalAnswer = summaryResult.summary || output;
          } catch {
            // Store for potential fallback, but don't send
            finalAnswer = output;
          }
        }

        sendEvent({
          type: "tool_result",
          data: {
            tool: toolName,
            status: "completed",
            output:
              typeof output === "string" ? output : JSON.stringify(output),
          },
        });
      }

      if (event.event === "on_tool_error") {
        const error = (event.data as any)?.error || "Unknown error";
        sendEvent({
          type: "tool_result",
          data: {
            tool: toolName,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      // Chain end - extract ONLY the orchestrator's final message (not tool outputs)
      // This is the final fallback after all tool calls complete
      // CRITICAL: If we've already started streaming tokens, don't send complete answer unless it's different
      if (event.event === "on_chain_end" && !answerSent && toolCallComplete) {
        const output = (event.data as any)?.output || {};

        // Try to get the final message from the chain output
        if (output?.messages && Array.isArray(output.messages)) {
          // Look for the LAST assistant message that is NOT a tool message
          // This should be the orchestrator's final response after processing tool results
          for (let i = output.messages.length - 1; i >= 0; i--) {
            const msg = output.messages[i];

            // Skip ALL tool messages (by name or by having tool_calls)
            if (
              msg.name === "summary_generator" ||
              msg.name === "fact_verifier" ||
              msg.name === "retriever" ||
              msg.tool_calls ||
              (msg.name && msg.name !== "assistant")
            ) {
              continue;
            }

            // Only process assistant messages without tool calls or tool names
            // This is the orchestrator's response, not a tool output
            if (
              msg?.content &&
              !msg.name &&
              !msg.tool_calls &&
              msg.role === "assistant"
            ) {
              let content = "";
              if (typeof msg.content === "string") {
                content = msg.content;
              } else if (Array.isArray(msg.content)) {
                content = msg.content
                  .map((c: any) =>
                    typeof c === "string" ? c : c?.text || c?.content || ""
                  )
                  .join("");
              } else {
                content = String(msg.content || "");
              }

              // Filter out tool outputs that might have leaked through
              const looksLikeToolOutput =
                content.includes('"isSufficient"') ||
                content.includes('"isAccurate"') ||
                content.includes('"confidence"') ||
                content.includes('"verifiedFacts"') ||
                content.includes('"issues"') ||
                (content.includes('"summary"') &&
                  content.includes('"ticketIds"'));

              // Filter out system prompts and user queries
              const isUserQuery =
                content.trim().toLowerCase() === input.trim().toLowerCase() ||
                content
                  .trim()
                  .toLowerCase()
                  .startsWith(input.trim().toLowerCase() + " ") ||
                content
                  .trim()
                  .toLowerCase()
                  .endsWith(" " + input.trim().toLowerCase());

              const isSystemPrompt =
                content.includes("STEP 1:") ||
                content.includes("REQUIRED WORKFLOW") ||
                content.includes("You are a helpful AI assistant") ||
                content.includes("You have access to these tools");

              // Check if content matches what we've already streamed
              const isDuplicate =
                hasStartedStreaming &&
                accumulatedTokens.trim() === content.trim();

              if (
                content &&
                !isSystemPrompt &&
                !isUserQuery &&
                !looksLikeToolOutput &&
                !isDuplicate && // Don't send if we've already streamed this exact content
                content.trim().length > 0 &&
                !answerSent // Prevent duplicate sends
              ) {
                finalAnswer = content;
                answerSent = true; // Set BEFORE sending to prevent race conditions
                sendEvent({
                  type: "agent_response",
                  data: {
                    content: content,
                    isStreaming: false,
                  },
                });
                break;
              } else if (isDuplicate) {
                // If it's a duplicate, just mark as sent without sending
                answerSent = true;
                finalAnswer = content;
              }
            }
          }
        }
      }
    }

    // Final fallback - only use if we have accumulated tokens but didn't send
    // Only use this if tools completed and we have orchestrator response tokens
    if (
      accumulatedTokens &&
      accumulatedTokens.trim().length > 0 &&
      !answerSent &&
      (!hasCalledTools || toolCallComplete) // Only use fallback if no tools or tools completed
    ) {
      const isSystemPrompt =
        accumulatedTokens.includes("You are a helpful AI assistant") ||
        accumulatedTokens.includes("REQUIRED WORKFLOW") ||
        accumulatedTokens.includes("STEP 1:") ||
        accumulatedTokens.includes("You have access to these tools");

      const isUserQuery =
        accumulatedTokens.trim().toLowerCase() === input.trim().toLowerCase() ||
        accumulatedTokens
          .trim()
          .toLowerCase()
          .startsWith(input.trim().toLowerCase() + " ");

      // Filter out tool outputs
      const looksLikeToolOutput =
        accumulatedTokens.includes('"isSufficient"') ||
        accumulatedTokens.includes('"isAccurate"') ||
        accumulatedTokens.includes('"confidence"') ||
        accumulatedTokens.includes('"verifiedFacts"') ||
        accumulatedTokens.includes('"issues"') ||
        (accumulatedTokens.includes('"summary"') &&
          accumulatedTokens.includes('"ticketIds"'));

      if (!isSystemPrompt && !isUserQuery && !looksLikeToolOutput) {
        answerSent = true;
        sendEvent({
          type: "agent_response",
          data: {
            content: accumulatedTokens.trim(),
            isStreaming: false,
          },
        });
        finalAnswer = accumulatedTokens.trim();
      }
    }

    return finalAnswer || accumulatedTokens.trim() || "No response generated";
  } catch (error: any) {
    sendEvent({
      type: "error",
      data: {
        error: error.message || String(error),
      },
    });
    throw error;
  }
}
