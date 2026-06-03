# Compliance Rules

.NET-native PRF/SORF/SRF compliance rules processor with an Angular 21 frontend and ASP.NET Core API.

## Architecture

```text
ComplianceRules.sln
src/
  ComplianceRules.Api/    ASP.NET Core host, /api endpoints, Angular static hosting
  ComplianceRules.Core/   Rule models, normalization, execution, bucket logic, workbook parsing
  ComplianceRules.Data/   Postgres/Neon schema and data access
  ComplianceRules.Web/    Angular 21 frontend
legacy/
  vercel-functions/       Old Vercel TypeScript API, retained only for reference
```

The active app is ASP.NET Core. Vercel Functions are no longer the primary backend.

## Runtime

- .NET 10 SDK
- Node.js 22
- Postgres connection string in `DATABASE_URL`

The app works with Neon Postgres or any compatible Postgres instance.

## Local Development

```powershell
$env:DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"

cd src/ComplianceRules.Web
npm install
npm run build

cd ../ComplianceRules.Api
dotnet restore
dotnet run
```

Open `https://localhost:7088` or `http://localhost:5088`.

For frontend-only development:

```powershell
cd src/ComplianceRules.Web
npm run dev
```

The frontend calls same-origin `/api` by default. To point it at a separately running API, edit:

```text
src/ComplianceRules.Web/public/runtime-config.js
```

```js
window.__COMPLIANCE_API_BASE__ = "https://localhost:7088";
```

Leave the value empty when ASP.NET Core serves the frontend and API together.

## API Routes

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
- `POST /api/rules`
- `PATCH /api/rules/:ruleId`
- `DELETE /api/rules/:ruleId`
- `POST /api/rules/seed`
- `POST /api/rules/import-daf`
- `GET /api/rules/:ruleId`
- `POST /api/rules/:ruleId/versions`
- `PATCH /api/rules/versions/:versionId`
- `POST /api/rules/versions/:versionId/approve`
- `POST /api/rules/variants/:variantId/test`
- `POST /api/rules/simulate`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/results`

## Azure App Service

Use the GitHub Actions workflow:

```text
.github/workflows/azure-app-service.yml
```

Required secrets:

- `AZURE_APP_SERVICE_NAME`
- `AZURE_APP_SERVICE_PUBLISH_PROFILE`

Required App Service application setting:

- `DATABASE_URL`

The workflow builds Angular, stages the built files into `src/ComplianceRules.Api/wwwroot`, publishes the ASP.NET Core app, and deploys the single app package.

## Database

`POST /api/bootstrap` creates the schema:

- source batches
- workflow rows
- rule definitions
- rule versions
- rule variants
- rule runs
- row execution results
- analyst overrides
- audit events

Rules are stored in Postgres as definitions, versions, variants, predicate JSON, action JSON, and original source metadata. Workbook execution reads the saved rules directly from the database.
