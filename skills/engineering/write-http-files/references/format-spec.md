# HTTP Request in Editor — full format reference

The complete grammar for `.http` / `.rest` files, based on the JetBrains
["HTTP Request in Editor" specification](https://github.com/JetBrains/http-request-in-editor-spec/blob/master/spec.md),
which extends RFC 7230. Read the section you need; the SKILL.md body already
covers the common path.

## Contents

- [File structure and separators](#file-structure-and-separators)
- [Request line](#request-line)
- [Request-target forms](#request-target-forms)
- [Multi-line paths, queries, and fragments](#multi-line-paths-queries-and-fragments)
- [Headers](#headers)
- [Message body](#message-body)
- [Multipart form data](#multipart-form-data)
- [Response handler scripts](#response-handler-scripts)
- [Response references](#response-references)
- [Variables](#variables)
- [Comments](#comments)
- [Encoding and whitespace rules](#encoding-and-whitespace-rules)

## File structure and separators

A file is a list of requests separated by `###`. The text after `###` on the same
line is treated as the request's name/comment. A file may begin or end with one or
more separators.

```http
###
GET http://example.com
###
POST http://example.com
###
```

## Request line

Format: `[method] request-target [http-version]`.

- **Methods**: `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `CONNECT`, `PATCH`,
  `OPTIONS`, `TRACE`.
- The method defaults to `GET` and the HTTP version is optional:

```http
http://example.com
POST http://example.com/api HTTP/1.1
```

## Request-target forms

**Origin form** — path only; requires a `Host` header:

```http
GET /api/get
Host: example.com
```

**Absolute form** — full URL. The scheme defaults to `http` when omitted:

```http
GET http://example.com:8080/api/get
GET https://example.com/path
```

**Asterisk form** — server-wide requests:

```http
OPTIONS *
```

## Multi-line paths, queries, and fragments

Long paths and queries can wrap across lines using indentation; leading/trailing
whitespace on each continuation line is trimmed.

```http
GET http://example.com/
    api
    /resource
    ?param=value&id=42
    &search=
    term
```

The URL **fragment** (`#...`) is client-side only and is **not** sent as part of
the request.

## Headers

Format: `field-name: value`. Names are case-insensitive. Header values are sent
without encoding.

```http
GET http://{{host}}/api/get
Content-Type: application/json
Authorization: Bearer {{token}}
```

## Message body

The body follows a **mandatory blank line** after the headers.

Inline body (surrounding whitespace is trimmed):

```http
POST http://example.com/api
Content-Type: application/json

{ "key": "value" }
```

Body from a file (sent verbatim — no trimming):

```http
POST http://example.com/api
Content-Type: application/json

< ./input.json
```

The body is passthrough: it is not parsed and `Content-Type` is not inferred —
set it explicitly. Body encoding follows the `Content-Type` charset, defaulting to
UTF-8.

## Multipart form data

```http
POST http://example.com/upload
Content-Type: multipart/form-data; boundary=abcd

--abcd
Content-Disposition: form-data; name="field"

value
--abcd
Content-Disposition: form-data; name="file"; filename="data.txt"

< ./data.txt
--abcd--
```

The presence of a `filename` parameter determines whether a part is sent as a
string or as a file.

## Response handler scripts

A response handler runs JavaScript (ECMAScript 5.1) after the response is
received. It begins with `>` and is either enclosed in `{% %}` or references an
external script file. It must not contain `%}` or `###`.

```http
GET http://example.com/auth

> {% client.global.set("auth", response.body.token); %}
```

External handler file:

```http
GET http://example.com/auth

> ./handle-auth.js
```

Common API inside the handler:

- `response.body`, `response.status`, `response.headers` — the response.
- `client.global.set(name, value)` — persist a value for later requests
  (read it as `{{name}}`).
- `client.test(name, fn)` / `client.assert(condition, message)` — assertions.

## Response references

Compare the current response against a previously saved one:

```http
GET http://example.com

<> previous-response.200.json
```

## Variables

`{{name}}` substitutes a value into the request target, headers, or body. Variable
names are case-sensitive.

```http
GET http://{{host}}/api/get?id={{element-id}}
```

Variable sources, in increasing order of scope:

- **In-file**: `@name = value` declared in the file (an IDE convenience). Later
  declarations can reference earlier ones: `@base = http://{{host}}/api`.
- **Environment files**: `http-client.env.json` (shared) and
  `http-client.private.env.json` (secrets) — see
  [environments.md](environments.md).
- **Dynamic**: generated at send time — `{{$uuid}}`, `{{$timestamp}}`,
  `{{$randomInt}}` (IDE-provided).

> The core spec defines `{{var}}` substitution and environment variables. In-file
> `@`-variables and dynamic `{{$...}}` variables are extensions provided by the
> JetBrains HTTP Client / VS Code REST Client. They're widely supported and worth
> using, but note them as tool features rather than the bare spec when it matters.

## Comments

Line comments start with `#` or `//`. They can appear before/after a request, among
headers, or at the start of a line within a body.

```http
# Health check
// also a comment
GET http://example.com/health
```

## Encoding and whitespace rules

- Non-ASCII characters in the path and query are percent-encoded as UTF-8 before
  sending. Already-encoded sequences are not double-encoded — to literally send
  `%20`, write `%2520`.
- Path and query whitespace is trimmed per line; for a literal space use `%20`.
- Inline request bodies are trimmed of surrounding whitespace; file-based bodies
  (`< ./file`) are preserved exactly.
- Headers and their values are sent without additional encoding.
