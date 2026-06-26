# Environment files for `.http` requests

Environment files let one `.http` file run against dev, staging, and production by
swapping a named environment instead of editing requests. They live next to the
`.http` files. This is a feature of the JetBrains HTTP Client and VS Code REST
Client; the core format only guarantees `{{variable}}` substitution.

## Two files, two jobs

- **`http-client.env.json`** — shared, non-secret values. Commit this.
- **`http-client.private.env.json`** — secrets (tokens, passwords, API keys).
  **Gitignore this.** Values here override the shared file for the same
  environment.

Both have the same shape: a top-level object whose keys are environment names,
each mapping to a flat object of variables.

## `http-client.env.json`

```json
{
  "dev": {
    "host": "localhost:8080",
    "scheme": "http",
    "apiVersion": "v1"
  },
  "staging": {
    "host": "api.staging.example.com",
    "scheme": "https",
    "apiVersion": "v1"
  },
  "prod": {
    "host": "api.example.com",
    "scheme": "https",
    "apiVersion": "v1"
  }
}
```

## `http-client.private.env.json` (gitignored)

Mirror the environment names; put only secrets here:

```json
{
  "dev": {
    "token": "dev-local-token"
  },
  "staging": {
    "token": "{{ secret from your vault }}"
  },
  "prod": {
    "token": "{{ secret from your vault }}"
  }
}
```

## Using them

Reference the variables exactly like any other `{{name}}`:

```http
### List users (runs against whichever env is selected)
GET {{scheme}}://{{host}}/api/{{apiVersion}}/users
Authorization: Bearer {{token}}
```

The developer picks the active environment in their editor (a dropdown in the
JetBrains HTTP Client; an environment selector in the VS Code REST Client). The
selected environment's variables — merged with the private file's overrides — fill
in the `{{...}}` placeholders.

## Checklist when you create these

- Keep the same environment names across both files.
- Put **only** secrets in the private file; everything else goes in the shared one.
- Add `http-client.private.env.json` to `.gitignore` and tell the user you did
  (or that they need to), so the secret never gets committed.
- Don't invent secret values — leave a clear placeholder and let the user fill it
  from their own vault.
