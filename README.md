# Price Scraper Backoffice

LLM-powered price comparison system for comparing product prices across configurable sites. Uses OpenAI to compare prices directly without traditional scraping. File-based storage (no database).

## Setup

```bash
# Backend
cd backend && npm install && npx playwright install chromium

# Backoffice
cd backoffice && npm install
```

### Optional: LLM Features

To enable LLM-based features, create a `.env` file in the `backend` directory:

```bash
OPENAI_API_KEY=your-api-key-here
OPENAI_MODEL=gpt-4o-mini  # Optional, defaults to gpt-4o-mini
```

**LLM Comparison** (primary method):
- System now uses LLM comparison exclusively (no traditional scraping)
- Directly compares prices across multiple sites using OpenAI
- Automatically skips sites that already have today's price data
- Merges existing same-day results with new LLM results
- Optionally select specific sites to compare
- Real-time streaming updates with animated loader

**Smart Caching**:
- If a product already has price data from today for a site, that site is skipped in LLM call
- Existing same-day results are included in final output
- Reduces API calls and speeds up comparison

**LLM Logging**:
- All LLM interactions are automatically logged to `logs/llm-YYYY-MM-DD.log`
- Logs include: requests (prompts), responses (raw + parsed), errors, and comparison metadata
- Log files are organized by date for easy review
- Logs directory is gitignored (not committed to repository)

## Run

```bash
# Terminal 1 - Backend (port 3001)
cd backend && npm run dev

# Terminal 2 - Backoffice (port 5173)
cd backoffice && npm run dev
```

Open http://localhost:5173

## Create User Account

Before using the application, you need to create a user account:

```bash
cd backend
npm run setup-user
```

Follow the prompts to create your username and password. Then log in at http://localhost:5173/login

## Usage

1. **Sites** - Add e-commerce sites with search URL template
2. **Products** - Add products with search terms and categories
3. **Compare Prices** - Select category/products and click "Compare Prices"
   - Uses LLM to compare prices across all enabled sites
   - Real-time streaming updates with animated loader
   - Automatically includes product page URLs in results
   - Skips sites with today's data (uses cached results)
