# Potential Scaling Plan

## Uploading Docs

- **Use existing `seedTickets`**: mechanism when users upload ticket exports
- **Parallel batch processing**: 200-500 docs/batch, 5-10 batches concurrently
- **Purging**: optionally purge vectors based on user preference

## Querying Pinecone DB

- **Adaptive topK**: depending on user's prompt, use higher/lower topK values

## Options for different agent patterns

### Multiple Agents + Orchestrator

- Instead of tools, retriever/summary/verifier could each be an agent.
- Orchestrator would coordinate between agents instead of directly calling tools.

### Different agents per customer

- If the user asks for summaries across different customers, orchestrator can call agents in parallel, assigning each agent a customer.
