# Rules Execution Engine

Angular 21 compliance rules processor with Neon Postgres support. The Angular frontend can use either the legacy Vercel TypeScript functions or the ASP.NET Core API in `dotnet-api/`.

## Local setup

1. Install dependencies with `npm install`.
2. Optional: set `DATABASE_URL` in `.env.local` for Neon-backed persistence.
3. Run `npm run dev` for the Angular app.
4. Run `vercel dev` when you want the Angular app and `/api/*` functions together.

Without `DATABASE_URL`, the API runs in demo memory mode. With Neon, `GET /api/health`, `GET /api/rules`, and `POST /api/bootstrap` ensure the schema exists and seed the bundled DAF-derived rules when the catalog is empty.

The operational `.xlsx` workbooks are intentionally ignored for public GitHub safety. The DAF logic is generated into `api/_shared/daf-seed.ts`, then seeded into Neon as rule definitions and variants. Analysts upload only PRF/SORF/SRF workbooks through Process PRF.

## ASP.NET Core API

The .NET API lives in `dotnet-api/` and mirrors the `/api/*` route surface used by Angular. It uses the same Neon schema and stored rule JSON.

1. Install the .NET SDK.
2. Set `DATABASE_URL`.
3. Run:

```powershell
cd dotnet-api
dotnet restore
dotnet run
```

To point Angular at a hosted .NET API, edit `public/runtime-config.js`:

```js
window.__COMPLIANCE_API_BASE__ = "https://your-dotnet-api.example.com";
```

Leave that value empty to keep same-origin `/api` calls.

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
- `POST /api/rules/seed`
- `POST /api/rules/import-daf`
- `GET /api/rules/:ruleId`
- `POST /api/rules/simulate`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/results`

## Vercel + Neon

Set `DATABASE_URL` in Vercel project environment variables. The API also accepts common Vercel/Neon aliases: `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, and `NEON_DATABASE_URL`. After deploy, open `/api/health` or `/rules`; the API will verify the schema and seed the bundled DAF-derived rules into Neon if needed.

Vercel does not provide an official .NET Function runtime. Use Vercel for the Angular frontend and host `dotnet-api/` on an ASP.NET Core capable platform, then set `public/runtime-config.js` to that API origin.
