# Pinecone RAG Template

General-purpose RAG starter built with Next.js, LangChain, OpenAI, and Pinecone.

The sample dataset in `data/ticketing_mock_reports.json` is synthetic demo data for public use.

## Quick Start

1. Install dependencies:
   ```bash
   yarn install
   ```
2. Add environment variables in `.env.local`:
   ```env
   OPENAI_API_KEY=[key]
   PINECONE_API_KEY=[key]
   PINECONE_INDEX_NAME=[index name]
   PINECONE_NAMESPACE=[namespace]
   ```
3. Start the app:
   ```bash
   yarn dev
   ```
4. Open:
   - Chat UI: `http://localhost:3000`
   - Eval UI: `http://localhost:3000/eval`

## Architecture

- `retriever`: semantic search with metadata filters (`customer`, `assignedTo`, `priority`, date range)
- `summary_generator`: structured markdown summary from retrieved documents
- `fact_verifier`: answer quality and hallucination check

Data flow: User query -> chat API -> agent orchestrator -> tools -> streaming response.
