# Talk Track — NC Governor's Communications Agent

## Slide 1: Title (5 seconds)
Don't linger. "Let me show you what we built for the Governor's Communications Office."

## Slide 2: The Ask (1 minute)
Read the two requests — these are their words. Emphasize: they came to us with two concrete problems, not a vague AI ask. Point out the green badge: all three capabilities are live in Teams today. This isn't a mockup.

## Slide 3: News Clips (2 minutes)
Walk the top flow (ingestion): "Every morning at 7 AM, a serverless function scrapes the Governor's press release page, reads each article, converts it into a meaning-vector, and stores it." Walk the bottom flow (query): "Staff open the chatbot in Teams and ask a question. The system searches by meaning, not just keywords — so 'rural internet access' finds 'broadband investment' even though they share zero words."

**Demo moment:** Switch to Teams, ask the agent "What clips came in this week about broadband?" Show the results. Point out the outlet, date, and the Governor mention quote.

## Slide 4: Remarks Search (2 minutes)
Walk the top flow (ingestion): "When a speech gets uploaded, the system chops it into paragraphs, embeds each one, and indexes it with the date and event." Walk the bottom flow (query + synthesis): "Staff ask a topic question. The system retrieves the most relevant passages across all speeches, then GPT-4o writes a synthesis with direct quotes and citations."

Name the RAG pattern: "This is Retrieval-Augmented Generation. The AI never makes things up — it only summarizes what it actually found in the Governor's own words."

**Demo moment:** Ask the agent "What has the Governor said about mental health and public safety?" Show the synthesis with direct quotes and source citations.

## Slide 5: Proofread + Platform Facts (1.5 minutes)
Walk the flow: "Paste a rough transcript, get back a clean version with every change explained and a confidence level." Emphasize: no data stored — text in, clean text out.

Point to the three cards at the bottom — these are your answers to the predictable questions:
- **Cost:** ~$120–195/month total. Serverless scales to zero.
- **Security:** Managed identity everywhere, no passwords in code, data stays in the state's Azure tenant.
- **Nothing stored** for proofread — privacy by design.

**Demo moment:** Paste the sample transcript with typos. Show the corrected output and the change list.

---

## If They Ask...
- **"Is the AI making things up?"** — No. Clips and remarks only summarize real documents. It shows sources with dates and direct quotes. Proofread shows every change with a reason.
- **"What if nobody uses it?"** — Functions scale to zero. Cosmos DB is serverless. Only fixed cost is AI Search at ~$70/mo.
- **"Can other offices use this?"** — Yes. Each capability is a separate Function. Infra is Bicep — spin up a copy with a parameter change.
- **"Why Teams?"** — Staff already live there. No new app, no new password, no training. Copilot Studio handles the UI and auth.
- **"How is this different from Googling?"** — Hybrid search (meaning + keywords + reranking), GPT-4o synthesis with citations, and it searches the Governor's own speeches which aren't on Google.
