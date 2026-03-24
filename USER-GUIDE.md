# User Guide — NC DIT AI Office Agent

## Getting Started

The AI Office Agent lives in Microsoft Teams via Copilot Studio. You interact with it by typing natural language questions — no special commands needed.

> **Status:** The backend API is fully deployed and tested. A Power Platform custom connector has been deployed to the GCC environment (`og-ai`). Copilot Studio agent topic configuration is the next step — once complete, the agent will be available in Teams.

### Finding the Agent

1. Open **Microsoft Teams**
2. Go to **Chat** → **New Chat**
3. Search for **"NC Comms Assistant"** (or whatever the final agent name is)
4. Start typing your question

---

## News Clips

### See Today's Clips

> "Show me today's clips"
> "What's in the news today?"
> "Latest mentions of Governor Stein"

The agent returns a list of articles with outlet, title, and a brief excerpt. Click any card to see the full mention context.

### Search Clips by Topic

> "Any clips about clean energy this week?"
> "News mentions about broadband from the last 30 days"
> "Find clips about the budget from March"

### Get Full Detail

> "Show me the full context for that WRAL article"
> "Give me more detail on the third clip"

---

## Remarks Search

### Search by Topic

> "What language have we used on clean tech?"
> "What have we said about education funding?"
> "Find our messaging on broadband access"

The agent returns a synthesis of relevant language with direct quotes, each cited with the date and event name.

### Find a Specific Quote

> "Find the exact quote about broadband from the State of the State"
> "What did we say about teacher pay at the press conference in January?"

### Compare Messaging Over Time

> "How has our education messaging changed since 2024?"
> "Compare our clean tech language from 2024 vs 2025"

---

## Transcript Proofreading

### Clean Up a Transcript

1. Type: **"Proofread this transcript"**
2. Paste the raw transcript text into the chat
3. The agent returns a corrected version with a summary of changes

### What It Fixes

- Speech-to-text errors (homophones, garbled words)
- Missing or incorrect punctuation
- Malformed speaker labels
- OCR artifacts

Uncertain corrections are flagged with `[?]` — review these before publishing.

---

## Tips

- **Be specific** — "clips about clean energy this week" works better than "show me stuff"
- **Use date ranges** — the agent understands "this week", "last 30 days", "since January", "in March 2026"
- **Ask follow-ups** — after a search, you can ask "tell me more about the third result" or "show me the full quote"
- **Upload new remarks** — drop `.txt` files in the SharePoint library and they'll be searchable within minutes (Word and PDF support coming soon)
- **Filename convention** — name remark files as `YYYY-MM-DD_event-name_venue.txt` (e.g., `2026-01-15_state-of-the-state_nc-general-assembly.txt`) for automatic metadata extraction
