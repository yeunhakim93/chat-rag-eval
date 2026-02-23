import { readFileSync } from "fs";
import { getIndex, verifyConnection } from "@/utils/pinecone";
import { generateEmbedding } from "@/utils/embedding";

interface TicketDocument {
  id: string;
  text: string;
  metadata: Record<string, any>;
}

interface SeedResult {
  success: boolean;
  documentsProcessed: number;
  documentsCreated: number;
  errors: string[];
  message: string;
}

/**
 * Converts a ticket object into a document format for Pinecone
 */
function convertTicketToDocument(ticket: any): TicketDocument {
  // Create a unique ID for the document
  const id = String(ticket.id);
  const date = new Date(ticket.date);
  const timestamp = date.getTime();

  // Enhance text with metadata for better semantic search
  const metadataParts: string[] = [];
  if (ticket.assignedTo) {
    metadataParts.push(`[assignee:${ticket.assignedTo}]`);
  }
  if (ticket.customer) {
    metadataParts.push(`[customer:${ticket.customer}]`);
  }
  if (ticket.date) {
    metadataParts.push(`[date:${ticket.date}]`);
    metadataParts.push(`[timestamp:${timestamp}]`);
  }
  if (ticket.priority) {
    metadataParts.push(`[priority:${String(ticket.priority).toUpperCase()}]`);
  }

  // Combine original text with metadata for embedding
  const enhancedText = `${metadataParts.join(" ")} ${ticket.text}`;

  const metadata: Record<string, any> = {
    id,
    customer: ticket.customer,
    assignedTo: ticket.assignedTo,
    priority: String(ticket.priority || "").toUpperCase(),
    timestamp: timestamp,
    text: enhancedText,
  };

  return {
    id,
    text: enhancedText,
    metadata,
  };
}

/**
 * Seeds Pinecone index with tickets from a JSON file
 */
export async function seedTickets(
  filePath: string = "data/ticketing_mock_reports.json"
): Promise<SeedResult> {
  try {
    // Verify Pinecone connection
    const isConnected = await verifyConnection();
    if (!isConnected) {
      return {
        success: false,
        documentsProcessed: 0,
        documentsCreated: 0,
        errors: ["Failed to connect to Pinecone"],
        message: "Cannot seed data: Pinecone connection failed",
      };
    }

    // Read and parse the file
    const fileContents = readFileSync(filePath, "utf-8");
    const data = JSON.parse(fileContents);

    // Handle both array and single object
    const tickets = Array.isArray(data) ? data : [data];

    if (tickets.length === 0) {
      return {
        success: false,
        documentsProcessed: 0,
        documentsCreated: 0,
        errors: ["No tickets found in file"],
        message: "Seed failed: no tickets to process",
      };
    }

    // Get Pinecone index
    const index = await getIndex();

    const documents: TicketDocument[] = tickets.map((ticket) =>
      convertTicketToDocument(ticket)
    );

    const errors: string[] = [];
    let documentsCreated = 0;

    // Process documents in batches (Pinecone has limits)
    const batchSize = 100;
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      try {
        // Generate embeddings for the batch
        const embeddingsPromises = batch.map((doc) =>
          generateEmbedding(doc.text)
        );
        const embeddings = await Promise.all(embeddingsPromises);

        // Prepare vectors for upsert
        const vectors = batch.map((doc, idx) => ({
          id: doc.id,
          values: embeddings[idx],
          metadata: doc.metadata, // Metadata already includes enhanced text
        }));

        // Upsert to Pinecone
        await index.upsert(vectors);
        documentsCreated += batch.length;
      } catch (batchError: any) {
        const errorMsg = `Error processing batch ${i / batchSize + 1}: ${
          batchError.message
        }`;
        errors.push(errorMsg);
        console.error(errorMsg, batchError);
      }
    }

    const success = errors.length === 0;

    return {
      success,
      documentsProcessed: documents.length,
      documentsCreated,
      errors,
      message: success
        ? `Successfully seeded ${documentsCreated} documents`
        : `Seeded ${documentsCreated} of ${documents.length} documents with ${errors.length} error(s)`,
    };
  } catch (error: any) {
    console.error("Seed error:", error);
    return {
      success: false,
      documentsProcessed: 0,
      documentsCreated: 0,
      errors: [error.message],
      message: `Seed failed: ${error.message}`,
    };
  }
}
