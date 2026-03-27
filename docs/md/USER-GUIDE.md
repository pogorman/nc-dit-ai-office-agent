# User Guide — NC DIT AI Office Agent

## Getting Started

The AI Office Agent lives in Microsoft Teams via Copilot Studio. You interact with it by typing natural language questions — no special commands needed.

> **Status:** The Copilot Studio agent is **fully deployed and working** in the GCC environment (`og-ai`). All three tools (QueryClips, QueryRemarks, ProofreadTranscript) are available in Teams.

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

Clips are updated automatically every morning at 7 AM from two sources: the Governor's official press releases (governor.nc.gov) and external news outlets found via 5 focused web search queries covering general coverage, budget/education, Helene recovery, healthcare, and law enforcement/economy. The system currently tracks 78 clips across 29 outlets. In the web demo, you can also click the green **Refresh Clips** button to trigger an immediate re-scan from both sources (using a wider 6-month timeframe for backfill).

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

## Audio/Video Transcription

### Transcribe a Recording

Upload an audio or video file to get a text transcript back in seconds.

**Supported formats:** MP3, MP4, WAV, WebM, M4A, MPEG, MPGA
**Max file size:** 25 MB (~25-30 minutes of MP3 audio)

The transcription is powered by Azure OpenAI Whisper. You can optionally specify a language hint (ISO 639-1 code like `"en"` or `"es"`) for better accuracy.

### Transcribe + Proofread (Best Results)

For the cleanest transcripts, chain both capabilities:
1. Upload your recording to get the raw Whisper transcript
2. Send the raw transcript to the Proofread function for cleanup

This catches Whisper errors on proper nouns (Governor Stein, General Assembly, etc.) and fixes punctuation/formatting issues.

### From the API

```bash
curl -X POST \
  "https://nc-comms-agent-dev-apim.azure-api.net/comms/transcribe" \
  -H "Ocp-Apim-Subscription-Key: YOUR_KEY" \
  -F "file=@press-conference.mp4"
```

---

## Dashboard

The dashboard provides operational visibility into the platform. Open it in a browser at **http://localhost:5173** (when running locally).

### Overview Tab
- Total clips and remarks counts
- Outlet breakdown (horizontal bars showing clips per outlet)
- Latest ingestion run status and timing (auto-refreshes)

### Clips Tab
- Paginated list of all clips sorted by publish date
- Filter by outlet name and date range

### Remarks Tab
- Table of all remarks documents with title, date, event, and chunk count

### Runs Tab
- History of all ingestion runs (timer and manual)
- Status badges (success / partial / failed)
- Source breakdown (gov vs web), timing, and counts

---

## Web Demo (Alternative)

If you don't have access to Teams or want to test outside of Copilot Studio, a standalone browser-based demo is available:

1. Ask your admin to start the demo server (`node demo-server.js`)
2. Open **http://localhost:9090** in your browser
3. Use the same natural language queries described above

> **Note:** The web demo routes through the same APIM gateway and backend functions as the Teams agent.

---

## Tips

- **Be specific** — "clips about clean energy this week" works better than "show me stuff"
- **Use date ranges** — the agent understands "this week", "last 30 days", "since January", "in March 2026"
- **Ask follow-ups** — after a search, you can ask "tell me more about the third result" or "show me the full quote"
- **Upload new remarks** — drop `.txt` files in the SharePoint library and they'll be searchable within minutes (Word and PDF support coming soon)
- **Filename convention** — name remark files as `YYYY-MM-DD_event-name_venue.txt` (e.g., `2026-01-15_state-of-the-state_nc-general-assembly.txt`) for automatic metadata extraction
