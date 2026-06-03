# Compliance Rules .NET API

ASP.NET Core API replacement for the Vercel TypeScript functions.

## Run Locally

Install the .NET SDK, then from this folder:

```powershell
$env:DATABASE_URL="postgresql://..."
dotnet restore
dotnet run
```

The API listens on the ASP.NET Core default URL and exposes the same `/api/...` routes used by the Angular app.

## Frontend Switch

Set `public/runtime-config.js` in the Angular app to the hosted API origin:

```js
window.__COMPLIANCE_API_BASE__ = "https://your-dotnet-api.example.com";
```

Leave it empty to keep same-origin `/api` calls.
