import { Pinecone } from "@pinecone-database/pinecone";

/** ────────────────────────────────────────────────────────────────────────────
 * Pinecone bootstrap and connection management
 * ─────────────────────────────────────────────────────────────────────────── */

interface PineconeConfig {
  apiKey: string;
  environment?: string;
}

let pineconeClient: Pinecone | null = null;

function getPineconeConfig(): PineconeConfig {
  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing PINECONE_API_KEY environment variable");
  }

  return {
    apiKey,
    environment: process.env.PINECONE_ENVIRONMENT,
  };
}

export function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    const config = getPineconeConfig();
    pineconeClient = new Pinecone({
      apiKey: config.apiKey,
    });
  }
  return pineconeClient;
}

export async function closePineconeClient(): Promise<void> {
  // Pinecone client doesn't require explicit cleanup
  pineconeClient = null;
}

/**
 * Gets a Pinecone index
 * @param indexName - Optional index name (defaults to PINECONE_INDEX_NAME env var)
 * @param namespace - Optional namespace (if not provided, uses default namespace represented as "")
 * 
 * Note: The empty string "" is Pinecone's default namespace. When you don't specify a namespace,
 * Pinecone uses the default namespace, which shows up as "" in API responses. This is expected behavior.
 */
export async function getIndex(
  indexName?: string,
  namespace?: string
): Promise<any> {
  const client = getPineconeClient();
  const index = indexName || process.env.PINECONE_INDEX_NAME || "default-index";
  // Use provided namespace or env var, or default to empty string (default namespace)
  const ns = namespace !== undefined 
    ? namespace 
    : (process.env.PINECONE_NAMESPACE !== undefined ? process.env.PINECONE_NAMESPACE : "");

  try {
    const indexClient = client.index(index);
    // If namespace is explicitly provided (even if empty string), use namespace client
    // Otherwise, use the index client directly (which uses default namespace)
    const namespaceClient = namespace !== undefined || process.env.PINECONE_NAMESPACE !== undefined
      ? indexClient.namespace(ns)
      : indexClient;
    // Check if index exists by trying to describe it
    await namespaceClient.describeIndexStats();
    return namespaceClient;
  } catch (error: any) {
    if (error.message?.includes("not found") || error.status === 404) {
      throw new Error(
        `Index "${index}"${ns ? ` (namespace: "${ns}")` : " (default namespace)"} not found. Please create it in Pinecone console.`
      );
    }
    throw error;
  }
}

/**
 * Verifies Pinecone connection
 */
export async function verifyConnection(): Promise<boolean> {
  try {
    const index = await getIndex();
    await index.describeIndexStats();
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes all vectors from the Pinecone index
 */
export async function deleteAllVectors(
  indexName?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const index = await getIndex(indexName);

    await index.deleteMany({});

    return {
      success: true,
      message: "All vectors deleted successfully",
    };
  } catch (error: any) {
    console.error("Delete all vectors error:", error);
    return {
      success: false,
      message: `Failed to delete vectors: ${error.message}`,
    };
  }
}
