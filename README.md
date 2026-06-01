# Rules Execution Engine

Angular 21 compliance rules processor with Vercel Functions and Neon Postgres support.

## Local setup

1. Install dependencies with `npm install`.
2. Optional: set `DATABASE_URL` in `.env.local` for Neon-backed persistence.
3. Run `npm run dev` for the Angular app.
4. Run `vercel dev` when you want the Angular app and `/api/*` functions together.

Without `DATABASE_URL`, the API runs in demo memory mode. With Neon, call `POST /api/bootstrap` once to create tables.

The operational `.xlsx` workbooks are intentionally ignored for public GitHub safety. In production, DAF rules live in Neon and analysts upload only PRF/SORF/SRF workbooks through Process PRF.

## Primary app routes

- `/` Compliance Rules overview
- `/upload` Process PRF
- `/execute` Execution Console
- `/workbench` Analyst Workbench
- `/reports` Outcome Reporting
- `/rules` Rule Catalog
- `/settings` API and environment settings

## API manifest

Open `/api/routes` for the live endpoint manifest.

Implemented endpoints:

- `GET /api/health`
- `GET /api/routes`
- `POST /api/bootstrap`
- `GET /api/batches`
- `POST /api/batches/upload`
- `POST /api/batches/sample`
- `GET /api/batches/:batchId`
- `DELETE /api/batches/:batchId`
- `GET /api/batches/:batchId/rows`
- `GET /api/batches/:batchId/summary`
- `POST /api/batches/:batchId/export`
- `PATCH /api/rows/:rowId`
- `GET /api/rules`
- `POST /api/rules/import-daf`
- `GET /api/rules/:ruleId`
- `POST /api/rules/simulate`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/results`

## Vercel + Neon

Set `DATABASE_URL` in Vercel project environment variables. The API also accepts common Vercel/Neon aliases: `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, and `NEON_DATABASE_URL`. After deploy, call `POST /api/bootstrap` once. DAF-derived rules should already be present in Neon before analysts process PRF/SORF/SRF workbooks.
