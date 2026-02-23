import { getIndex } from "@/utils/pinecone";
import { generateEmbedding } from "@/utils/embedding";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { ChatFilters } from "@/types/chat";

export interface RetrievalResult {
  documents: Array<{
    id: string;
    score: number;
    metadata: Record<string, any>;
    text: string;
  }>;
  count: number;
  success: boolean;
  error?: string;
}

/**
 * Retriever: Retrieves relevant documents from Pinecone based on user query
 * Uses metadata filters (assignee, customer, priority, date range) when provided to narrow results
 * Extracts assignee from natural language query for metadata filtering
 * Date range filtering uses Pinecone's $gte and $lte operators on dateTimestamp field
 */
export async function executeRetriever(
  userQuery: string,
  topK: number = 25,
  filters?: ChatFilters
): Promise<RetrievalResult> {
  try {
    const index = await getIndex();

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(userQuery);

    // Build metadata filters using provided filters
    const metadataFilter: Record<string, any> = {};

    // Use customer filter if provided in filters
    if (filters?.customer) {
      metadataFilter.customer = filters.customer;
    }

    // Use assignedTo from filters if explicitly provided
    if (filters?.assignedTo && !metadataFilter.assignedTo) {
      metadataFilter.assignedTo = filters.assignedTo;
    }

    // Use priority filter if provided
    if (filters?.priority) {
      metadataFilter.priority = filters.priority.toUpperCase();
    }

    // Add date range filtering using Pinecone metadata filters
    // Pinecone requires numeric values for $gte and $lte operators
    if (
      filters?.dateRange &&
      (filters.dateRange.startDate || filters.dateRange.endDate)
    ) {
      const dateFilter: Record<string, any> = {};

      if (filters.dateRange.startDate) {
        const startTimestamp = new Date(filters.dateRange.startDate).getTime();
        dateFilter.$gte = startTimestamp;
      }

      if (filters.dateRange.endDate) {
        const endTimestamp = new Date(filters.dateRange.endDate).getTime();
        dateFilter.$lte = endTimestamp;
      }

      // Only add date filter if we have at least one bound
      if (Object.keys(dateFilter).length > 0) {
        metadataFilter.timestamp = dateFilter;
      }
    }

    // Query Pinecone
    const queryOptions: any = {
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    };

    // Add metadata filter if we have any filters
    if (Object.keys(metadataFilter).length > 0) {
      queryOptions.filter = metadataFilter;
    }

    const queryResponse = await index.query(queryOptions);

    // Map results
    let documents = (queryResponse.matches || []).map((match: any) => ({
      id: match.id,
      score: match.score || 0,
      metadata: match.metadata || {},
      text: match.metadata?.text || "", // Get text from metadata (stored during seeding)
    }));

    // Log for debugging
    console.log(`Retriever query: "${userQuery}", filters:`, metadataFilter);
    console.log(`Found ${documents.length} documents before text filter`);
    console.log(`Sample document metadata:`, documents[0]?.metadata);

    // Filter out documents without text (but keep some for debugging)
    const documentsWithText = documents.filter(
      (doc: { text: string }) => doc.text && doc.text.trim().length > 0
    );

    // If we have matches but no text, log a warning
    if (documents.length > 0 && documentsWithText.length === 0) {
      console.warn(
        `Found ${documents.length} documents but none have text in metadata. This may indicate a seeding issue.`
      );
      console.warn(
        `First document metadata keys:`,
        Object.keys(documents[0]?.metadata || {})
      );
    }

    documents = documentsWithText;

    return {
      documents,
      count: documents.length,
      success: true,
    };
  } catch (error: any) {
    console.error("Retriever error:", error);
    return {
      documents: [],
      count: 0,
      success: false,
      error: error.message,
    };
  }
}

/**
 * Creates a LangChain tool for retrieval
 */
export function createRetrieverTool(filters?: ChatFilters) {
  return new DynamicStructuredTool({
    name: "retriever",
    description:
      "Retrieves relevant documents from the knowledge base based on the user's query using semantic search. Uses metadata filters (assignee, customer, priority, date range) when provided in the filters parameter. Date range filtering uses Pinecone's native metadata filtering for efficient querying.",
    schema: z.object({
      userQuery: z.string().describe("The user's query to search for"),
      topK: z
        .number()
        .optional()
        .default(25)
        .describe("Number of documents to retrieve (default: 25)"),
    }),
    func: async ({ userQuery, topK }) => {
      const result = await executeRetriever(userQuery, topK, filters);
      if (!result.success || result.documents.length === 0) {
        return result.error || "No documents found";
      }
      // Return just the array of documents with proper formatting
      return JSON.stringify(result.documents, null, 2);
    },
  });
}
