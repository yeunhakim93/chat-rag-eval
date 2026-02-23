import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface SummaryResult {
  summary: string; // Main summary text in Markdown format (for backwards compatibility and display)
}

/**
 * Summary Generator: Generates a structured summary from retrieved documents with retry logic
 */
export async function summaryGenerator(
  userQuery: string,
  documents: Array<{
    id: string;
    score: number;
    metadata: Record<string, any>;
    text: string;
  }>,
  model: string = "gpt-4o",
  conversationContext?: string,
  maxAttempts: number = 3
): Promise<SummaryResult> {
  const systemPrompt = `You are a factual AI assistant that generates accurate, well-structured summaries from employee tickets. Your responsibility is ACCURACY - never fabricate, infer, or extrapolate.

CORE RULES:
- Use ONLY information explicitly stated in documents
- If no relevant information found, respond: "Based on the search results, there were no related tickets found that match your query."
- Verify each fact before including it
- Extract and structure information clearly using Markdown formatting

${conversationContext || ""}

OUTPUT FORMAT (Markdown):
Generate a well-structured, comprehensive summary in Markdown format. Use the following structure:

## Summary

[Provide a concise overview of the retrieved documents in 2-3 sentences. ALWAYS include specific dates when available - mention when events occurred, date ranges, or specific dates referenced in the documents]

## Key Findings

- [Retrieved document 1 with relevant details and dates]
- [Retrieved document 2 with relevant details and dates]
- [Continue as needed - ALWAYS include dates when available]

## Ticket Details

**Ticket IDs:** [List ticket IDs referenced, e.g., "ticket-123, ticket-456"]
**Time Period:** [ALWAYS include date range - start date to end date, e.g., "2024-01-15 to 2024-01-20"]
**Specific Dates:** [List all specific dates mentioned in the tickets, e.g., "2024-01-15, 2024-01-18, 2024-01-20"]
**Locations:** [Locations mentioned, if any]
**Personnel:** [Employees or people mentioned, if any]

## Incidents & Events

[If applicable, list structured incidents with:]
- **Type:** [Incident type]
- **Description:** [What happened]
- **Ticket ID:** [Related ticket]
- **Date:** [ALWAYS include the specific date when it occurred - format: YYYY-MM-DD]

## Timeline

[If multiple dates are involved, provide a chronological timeline:]
- **Date:** [YYYY-MM-DD] - [Event description]
- **Date:** [YYYY-MM-DD] - [Event description]

## Additional Information

[Any other relevant details, statistics, or context]

---

**Total Tickets Analyzed:** [number]
**Date Range Covered:** [Start date to End date - ALWAYS include this]
**Confidence Level:** [High/Medium/Low based on document quality and completeness]

CRITICAL: DATES ARE REQUIRED
- ALWAYS include dates in the Summary section when mentioning events
- ALWAYS include a Time Period in Ticket Details (even if approximate)
- ALWAYS include specific dates when listing incidents
- Extract dates from document metadata (timestamp field) or from document text
- Format dates as YYYY-MM-DD when possible
- If dates are not available, state "Dates not specified in source documents"

IMPORTANT FORMATTING:
- Use proper Markdown syntax (headers, lists, bold text, etc.)
- Make the summary easy to read and well-organized
- Include ticket IDs when referencing specific documents
- Use bullet points for lists and structured information
- Be thorough but concise
- Ensure all facts are directly traceable to the source documents
- PRIORITIZE including dates - they are essential for understanding the timeline of events`;

  // Extract dates from document metadata for context
  const documentDates = documents
    .map((doc) => {
      if (doc.metadata?.timestamp) {
        const timestamp = doc.metadata.timestamp;
        const date = new Date(
          typeof timestamp === "number" ? timestamp : parseInt(timestamp)
        );
        if (!isNaN(date.getTime())) {
          return date.toISOString().split("T")[0]; // Format as YYYY-MM-DD
        }
      }
      return null;
    })
    .filter((d): d is string => d !== null);

  const dateContext =
    documentDates.length > 0
      ? `\n\nIMPORTANT: Document metadata indicates dates/timestamps. Extract and use these dates in your summary:\n${[
          ...new Set(documentDates),
        ]
          .sort()
          .join(", ")}`
      : "";

  const userPrompt = `User Question: ${userQuery}

Retrieved Documents (${documents.length} total):
${documents
  .map((doc, idx) => {
    const dateInfo = doc.metadata?.timestamp
      ? ` (Date/Timestamp: ${doc.metadata.timestamp})`
      : "";
    return `Document ${idx + 1} (ID: ${doc.id}, score: ${doc.score.toFixed(
      3
    )}${dateInfo}):
${doc.text.substring(0, 1500)}${doc.text.length > 1500 ? "..." : ""}
`;
  })
  .join("\n---\n")}${dateContext}

Please provide a well-structured, comprehensive summary in Markdown format that addresses the user's question based on the retrieved documents above. Use the Markdown structure provided in the system prompt to create a clear, organized, and easy-to-read summary. 

CRITICAL: Make sure to include ALL dates mentioned in the documents or found in document metadata. Dates are essential for understanding when events occurred.`;

  let lastError: Error | null = null;
  let bestResult: SummaryResult | null = null;

  // Try multiple times to get a good summary
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const llm = new ChatOpenAI({
        modelName: model,
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: attempt === 1 ? 0 : 0.2, // Slight variation on retries
      });

      const retryNote =
        attempt > 1
          ? `\n\nNote: This is attempt ${attempt} of ${maxAttempts}. Please ensure the summary is comprehensive, well-structured with proper Markdown formatting, and includes all relevant details from the documents.`
          : "";

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt + retryNote),
      ];

      const response = await llm.invoke(messages);
      const content = response.content?.toString() || "";

      // Validate the summary quality
      if (!content || content.trim().length === 0) {
        throw new Error("Summary is empty");
      }

      // Check if it looks like a well-formatted Markdown summary
      const hasHeaders = content.includes("##") || content.includes("#");
      const hasStructure =
        content.includes("Summary") || content.includes("Ticket");
      const hasMinimumLength = content.trim().length > 100;
      // Check if dates are included (look for date patterns or date-related keywords)
      const hasDates =
        /\d{4}-\d{2}-\d{2}/.test(content) ||
        /\d{1,2}\/\d{1,2}\/\d{4}/.test(content) ||
        content.toLowerCase().includes("date") ||
        content.toLowerCase().includes("time period") ||
        content.toLowerCase().includes("timeline");

      if (hasMinimumLength) {
        const result: SummaryResult = {
          summary: content.trim(),
        };

        // If we got a well-structured result with proper Markdown formatting and dates, we can stop early
        if (hasHeaders && hasStructure && hasDates && content.length > 200) {
          console.log(
            `Summary generation succeeded on attempt ${attempt}/${maxAttempts} with well-structured Markdown and dates`
          );
          return result;
        }

        // If we have dates but structure could be better, still prefer this result
        if (hasDates && !bestResult) {
          bestResult = result;
        }

        // Store as best result if we don't have one yet
        if (!bestResult) {
          bestResult = result;
        }
      } else {
        throw new Error("Summary is too short or lacks structure");
      }
    } catch (error: any) {
      console.warn(
        `Attempt ${attempt}: Summary generation error:`,
        error.message
      );
      lastError = error;

      // If this is the last attempt, fall back to a simple text summary
      if (attempt === maxAttempts && !bestResult) {
        // Generate a simple fallback summary
        try {
          const llm = new ChatOpenAI({
            modelName: model,
            openAIApiKey: process.env.OPENAI_API_KEY,
            temperature: 0,
          });

          const fallbackMessages = [
            new SystemMessage(
              "You are a factual AI assistant. Generate a concise, well-formatted Markdown summary based on the documents provided."
            ),
            new HumanMessage(
              `User Question: ${userQuery}\n\nDocuments:\n${documents
                .map((d) => d.text.substring(0, 500))
                .join(
                  "\n---\n"
                )}\n\nProvide a concise summary in Markdown format.`
            ),
          ];

          const fallbackResponse = await llm.invoke(fallbackMessages);
          const fallbackSummary =
            fallbackResponse.content?.toString() || "No summary generated.";

          return {
            summary: fallbackSummary,
          };
        } catch (fallbackError) {
          // Last resort
          return {
            summary:
              "## Summary\n\nBased on the search results, there were no related tickets found that match your query.",
          };
        }
      }
    }
  }

  // Return the best result we got, or a fallback
  if (bestResult) {
    return bestResult;
  }

  throw (
    lastError ||
    new Error(`Summary generation failed after ${maxAttempts} attempts`)
  );
}

/**
 * Creates a LangChain tool for summary generation
 */
export function createSummaryGeneratorTool(model: string) {
  return new DynamicStructuredTool({
    name: "summary_generator",
    description:
      "Generates a well-structured, comprehensive summary in Markdown format based on documents retrieved from the knowledge base. Returns a Markdown-formatted summary with sections for overview, ticket details, incidents, and additional information. The summary is formatted for easy reading and includes all relevant details from the documents.",
    schema: z.object({
      userQuery: z.string().describe("The original user query"),
      documents: z
        .array(
          z.object({
            id: z.string(),
            score: z.number(),
            metadata: z.record(z.string(), z.any()).optional(),
            text: z.string(),
          })
        )
        .describe("The documents retrieved from the retriever tool"),
    }),
    func: async ({ userQuery, documents }) => {
      // Ensure metadata is always defined
      const documentsWithMetadata = documents.map((doc) => ({
        ...doc,
        metadata: doc.metadata || {},
      }));
      const result = await summaryGenerator(
        userQuery,
        documentsWithMetadata,
        model
      );
      return JSON.stringify(result);
    },
  });
}
