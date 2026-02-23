import { NextRequest, NextResponse } from "next/server";
import { seedTickets } from "@/service/seed";
import { getIndex } from "@/utils/pinecone";

/**
 * POST endpoint to seed ticket data into Pinecone
 */
export async function POST(_request: NextRequest) {
  try {
    const result = await seedTickets();

    if (result.success) {
      return NextResponse.json(
        {
          success: true,
          message: result.message,
          documentsCreated: result.documentsCreated,
          documentsProcessed: result.documentsProcessed,
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
          documentsCreated: result.documentsCreated,
          documentsProcessed: result.documentsProcessed,
          errors: result.errors,
        },
        { status: result.documentsCreated > 0 ? 207 : 500 } // 207 Multi-Status if partial success
      );
    }
  } catch (error: any) {
    console.error("Seed error:", error);
    return NextResponse.json(
      {
        success: false,
        message: `Seed failed: ${error.message}`,
        error: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check index stats
 */
export async function GET() {
  try {
    const index = await getIndex();
    const stats = await index.describeIndexStats();

    return NextResponse.json({
      totalVectors: stats.totalRecordCount || 0,
      indexDimension: stats.dimension,
      indexFullness: stats.indexFullness,
      namespaces: stats.namespaces || {},
    });
  } catch (error: any) {
    console.error("Error querying Pinecone index:", error);
    return NextResponse.json(
      { error: `Failed to query Pinecone index: ${error.message}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint to reset/clear all vectors from the index
 * WARNING: This permanently deletes all data!
 *
 * Since Pinecone doesn't allow empty filters, we fetch stats first,
 * then delete all vectors by querying with a dummy vector and deleting the results,
 * or by deleting the entire namespace if using serverless.
 */
export async function DELETE(_request: NextRequest) {
  try {
    const index = await getIndex();

    // Get index stats to see how many vectors we have
    const stats = await index.describeIndexStats();
    const totalVectors = stats.totalRecordCount || 0;

    if (totalVectors === 0) {
      return NextResponse.json(
        {
          success: true,
          message: "Index is already empty",
          deletedCount: 0,
        },
        { status: 200 }
      );
    }

    // Strategy: Query with a dummy vector to get all IDs, then delete them
    // Create a dummy embedding (same dimension as your index)
    // First, we need to know the dimension - let's query with a small topK
    const dimension = stats.dimension || 1536; // Default to text-embedding-3-small dimension
    const dummyVector = new Array(dimension).fill(0);

    // Query with very large topK to get all IDs (Pinecone supports up to 10,000)
    // If you have more than 10,000 vectors, we'll need to batch this
    const maxTopK = 10000;
    const topK = Math.min(totalVectors, maxTopK);

    const queryResult = await index.query({
      vector: dummyVector,
      topK: topK,
      includeMetadata: false,
    });

    // Extract all IDs
    const idsToDelete = (queryResult.matches || []).map(
      (match: any) => match.id
    );

    if (idsToDelete.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No vectors found to delete",
        },
        { status: 404 }
      );
    }

    // Delete in batches (Pinecone deleteMany supports up to 1000 IDs per request)
    const batchSize = 1000;
    let deletedCount = 0;

    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      await index.deleteMany(batch);
      deletedCount += batch.length;
    }

    // If we have more than maxTopK vectors, we need to handle the rest
    // by querying again with different vectors or using a different strategy
    if (totalVectors > maxTopK) {
      return NextResponse.json(
        {
          success: true,
          message: `Deleted ${deletedCount} vectors. Index had ${totalVectors} total vectors. You may need to delete the remaining vectors manually or recreate the index.`,
          deletedCount,
          totalVectors,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `Successfully deleted ${deletedCount} vectors`,
        deletedCount,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Delete error:", error);
    return NextResponse.json(
      {
        success: false,
        message: `Delete failed: ${error.message}`,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
