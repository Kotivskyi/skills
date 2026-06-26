---
name: write-http-files
description: >
  Author `.http` / `.rest` request files in the "HTTP Request in Editor" format
  used by the JetBrains HTTP Client and the VS Code REST Client extension. Use
  whenever the user wants to create, scaffold, or edit runnable HTTP requests in
  an editor — turning a curl command, an OpenAPI/Swagger spec, endpoint
  documentation, or a described API into a `.http` file; building a request
  collection for an API; adding auth/variables/environments to existing requests;
  or capturing a token from one response to reuse in the next. Reach for this even
  when the user just says "make me a file to test this endpoint" without naming the
  format.
---
# Write HTTP request files

Produce `.http` (or `.rest`) files in the **HTTP Request in Editor** format — the
format the JetBrains HTTP Client and the VS Code REST Client extension run
directly from the editor. The goal is files a developer can open and execute
request-by-request without leaving their IDE, with variables and environments
factored out so the same file works across dev/staging/prod.

This format extends RFC 7230 with three things plain HTTP can't express: many
requests in one file, response-handler scripts, and `{{variable}}` substitution.

## When to use

- Creating a file to "test", "hit", or "call" an endpoint or API
- Converting a `curl` command, an OpenAPI/Swagger spec, or endpoint docs into runnable requests
- Building a collection of requests for a service (CRUD, auth flow, smoke tests)
- Adding variables, environments, or auth to existing `.http` files
- Chaining requests — log in, capture a token, use it in later requests

## Workflow

1. **Pick the filename.** Use `.http` (preferred) or `.rest`. Name it after the
   service or flow: `auth.http`, `users-api.http`, `smoke.http`.
2. **Factor out what varies.** Host, base path, ids, and secrets become
   `{{variables}}` from the start — never hardcode `https://api.staging...` or a
   bearer token inline. Decide where each variable lives (see Variables below).
3. **Write the requests**, separated by `###`. Order them so a human can run them
   top to bottom (auth first, then the calls that need the token).
4. **Wire up chaining** with response handlers (`> {% ... %}`) when a later
   request depends on an earlier response.
5. **If environments are needed**, create `http-client.env.json` for shared,
   non-secret values and `http-client.private.env.json` (gitignored) for secrets.
6. **Add a one-line comment** above each request saying what it does, so the file
   reads as living documentation.

## Essential format

A request is: an optional `###` separator, the request line, header lines, a
**blank line**, then the body. The blank line before the body is mandatory.

```http
### Get a user by id
GET https://{{host}}/api/users/{{userId}}
Accept: application/json

###

### Create a user
POST https://{{host}}/api/users
Content-Type: application/json

{
  "name": "Ada Lovelace",
  "email": "ada@example.com"
}
```

Rules worth internalizing:

- **Request line**: `[METHOD] request-target [HTTP-version]`. Method defaults to
  `GET` and the version is optional, so `https://{{host}}/health` is a valid GET.
- **Separators**: `###` between requests; text after it on the same line is the
  request's title/comment. A leading/trailing `###` is fine.
- **Comments**: lines starting with `#` or `//`.
- **Body from a file**: `< ./payload.json` on its own line (after the blank line)
  instead of an inline body. File bodies are sent verbatim; inline bodies are
  trimmed.
- **Bodies are passthrough** — set `Content-Type` yourself; the format does not
  infer it from the body.

## Variables

Reference any variable as `{{name}}` in the request target, headers, or body.
Variables come from three places — prefer the lowest-friction one that fits:

- **In-file variables** for values reused within one file:
  `@host = api.example.com` near the top, then `{{host}}`. Good for a base URL or
  a shared id while iterating.
- **Environment files** for values that change per environment (dev/staging/prod).
  Non-secret values go in `http-client.env.json`; secrets go in
  `http-client.private.env.json` (must be gitignored). See
  [references/environments.md](references/environments.md).
- **Dynamic variables** for generated values: `{{$uuid}}`, `{{$timestamp}}`,
  `{{$randomInt}}`. Useful for idempotency keys and unique test data.

When secrets are involved, never inline them — route them through the private env
file and reference `{{token}}`. Call this out to the user so the secret doesn't
land in version control.

## Chaining requests

A response handler runs JavaScript after a response arrives; use it to stash a
value for later requests via `client.global.set`. Later requests read it as
`{{name}}`.

```http
### Log in and capture the token
POST https://{{host}}/auth/login
Content-Type: application/json

{ "user": "{{user}}", "password": "{{password}}" }

> {%
  client.global.set("token", response.body.token);
  client.test("got a token", () => client.assert(response.body.token));
%}

###

### Use the captured token
GET https://{{host}}/api/me
Authorization: Bearer {{token}}
```

The handler block starts with `>` and is enclosed in `{% %}`; it cannot contain
`%}` or `###`. To compare against a saved response, use `<> previous.200.json`.

## Reference material

The body above covers the common cases. Read these when a task needs more:

- [references/format-spec.md](references/format-spec.md) — the full grammar:
  request-target forms (origin/absolute/asterisk), multi-line URLs and queries,
  multipart bodies, encoding/whitespace rules, response references. Read this when
  building anything beyond a straightforward request or when you're unsure how the
  format handles an edge case.
- [references/environments.md](references/environments.md) — the exact shape of
  `http-client.env.json` / `http-client.private.env.json`, how environment
  selection works, and the gitignore note for secrets.

## Quality bar

Before handing back a file, check:

- Every request is separated by `###` and has a one-line title comment.
- There's a blank line between the last header and the body.
- Hosts, ids, and secrets are `{{variables}}`, not hardcoded.
- `Content-Type` is set on every request that has a body.
- Requests are ordered so they run top-to-bottom (auth/setup first).
- If you introduced an env file, secrets are in the `private` one and you told the
  user to gitignore it.
