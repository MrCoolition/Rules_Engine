# ComplianceRules.Api

ASP.NET Core host for the Compliance Rules app.

Responsibilities:

- Serves `/api/*` endpoints.
- Serves Angular static files from `wwwroot`.
- Connects directly to Postgres through `ComplianceRules.Data`.
- Executes saved rules through `ComplianceRules.Core`.

Local run:

```powershell
$env:DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
dotnet run --project src/ComplianceRules.Api/ComplianceRules.Api.csproj
```

Publishing the project can build the Angular client automatically unless `BuildClientApp=false` is supplied.
