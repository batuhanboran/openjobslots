# OpenJobSlots — Web Frontend (Next.js)

Brave-Search-styled public frontend for OpenJobSlots. Serves the homepage (`/`)
and search results (`/ara`), and transparently proxies all other paths (API,
mobile, SEO) to the existing Node backend via `next.config.ts` rewrites.

- Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind v4
- Search: relevance-ranked `GET {OJS_API_BASE}/postings` via the `/api/postings` proxy
- i18n: 12-language UI (see `src/lib/i18n.ts`); region filter maps to backend country/continent params
- Deploy: containerized (`Dockerfile`, `output: standalone`); see `DEPLOY.md`

## Dev
```bash
npm install
npm run dev   # http://localhost:3000  (OJS_API_BASE defaults to https://openjobslots.com)
```
