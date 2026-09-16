#!/usr/bin/env python3
"""Create a Paperclip task and assign it to a role (default: CTO).

Stdlib only — no pip installs. Talks to a running Paperclip instance over its
HTTP API. Resolves the company and the assignee agent by role so the caller
never has to hard-code ids that differ per company/instance.

Typical use (from the handoff-to-paperclip skill):

    python3 handoff_task.py \
        --title "Continue PAS spec: harden G2 gate" \
        --body-file /tmp/handoff-xyz.md \
        --assignee-role cto \
        --priority high \
        --dry-run            # preview the payload; POST nothing

Drop --dry-run to actually create the task. Add --attach <path> (repeatable)
to upload files (e.g. the handoff doc) to the created issue.

Auth: in Paperclip Desktop's default `local_trusted` mode no token is needed.
If the API returns 401/403, pass --api-key or set PAPERCLIP_API_KEY.
"""
import argparse
import json
import mimetypes
import os
import subprocess
import sys
import urllib.error
import urllib.request

DEFAULT_BASE = os.environ.get("PAPERCLIP_API_URL", "http://localhost:3100")

# Paperclip allowlists attachment content types; Python's mimetypes misses some
# (e.g. .md → octet-stream), which the server rejects with 422. Map the common
# ones explicitly, mirroring the sibling paperclip-upload-artifact.sh script.
CONTENT_TYPES = {
    ".md": "text/markdown", ".markdown": "text/markdown",
    ".txt": "text/plain", ".log": "text/plain",
    ".json": "application/json", ".csv": "text/csv",
    ".html": "text/html", ".htm": "text/html",
    ".pdf": "application/pdf", ".zip": "application/zip",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
}


def content_type_for(path):
    ext = os.path.splitext(path)[1].lower()
    return CONTENT_TYPES.get(ext) or mimetypes.guess_type(path)[0] or "text/plain"


def _req(method, url, api_key, data=None, headers=None, timeout=20):
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if api_key:
        hdrs["Authorization"] = f"Bearer {api_key}"
    body = None
    if data is not None and not isinstance(data, (bytes, bytearray)):
        body = json.dumps(data).encode()
        hdrs.setdefault("Content-Type", "application/json")
    elif isinstance(data, (bytes, bytearray)):
        body = data
    req = urllib.request.Request(url, data=body, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw
        return e.code, parsed
    except urllib.error.URLError as e:
        die(f"Cannot reach Paperclip at {url}: {e.reason}. Is the instance running?")


def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def resolve_company(base, api_key, company_id):
    status, companies = _req("GET", f"{base}/api/companies", api_key)
    if status in (401, 403):
        die("Auth required (401/403). Pass --api-key or set PAPERCLIP_API_KEY.")
    if status != 200 or not isinstance(companies, list):
        die(f"Could not list companies (HTTP {status}): {companies}")
    if company_id:
        match = [c for c in companies if c.get("id") == company_id]
        if not match:
            die(f"Company id {company_id} not found.")
        return match[0]
    active = [c for c in companies if c.get("status") == "active"]
    if len(active) == 1:
        return active[0]
    listing = "\n".join(
        f"  {c.get('id')}  {c.get('name')}  [{c.get('status')}]" for c in companies
    )
    die(
        "Multiple (or zero) active companies — pass --company-id. Available:\n"
        + listing
    )


def resolve_agent(base, api_key, company_id, role):
    status, agents = _req(
        "GET", f"{base}/api/companies/{company_id}/agents", api_key
    )
    if status != 200 or not isinstance(agents, list):
        die(f"Could not list agents (HTTP {status}): {agents}")
    role_l = role.lower()
    by_role = [a for a in agents if (a.get("role") or "").lower() == role_l]
    if not by_role:
        # fall back to name match (e.g. "CTO")
        by_role = [a for a in agents if (a.get("name") or "").lower() == role_l]
    if not by_role:
        roles = ", ".join(sorted({a.get("role") for a in agents if a.get("role")}))
        die(f"No agent with role '{role}'. Available roles: {roles}")
    if len(by_role) > 1:
        opts = "\n".join(f"  {a.get('id')}  {a.get('name')}" for a in by_role)
        die(f"Multiple agents match role '{role}':\n{opts}\nUse a more specific role.")
    return by_role[0]


def upload_attachment(base, api_key, company_id, issue_id, file_path):
    """Upload via curl -F — the proven multipart contract used across Paperclip.

    Hand-rolled urllib multipart is fragile and the server rejects it (422), so
    we delegate to curl, which is required by the sibling upload scripts anyway.
    Returns (ok, message).
    """
    ctype = content_type_for(file_path)
    url = f"{base}/api/companies/{company_id}/issues/{issue_id}/attachments"
    cmd = ["curl", "-sS", "-X", "POST", "-w", "\n%{http_code}",
           "-F", f"file=@{file_path};type={ctype}"]
    if api_key:
        cmd += ["-H", f"Authorization: Bearer {api_key}"]
    cmd.append(url)
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        return False, "curl not found — cannot upload attachment"
    body, _, code = out.stdout.rpartition("\n")
    if code.strip() in ("200", "201"):
        return True, code.strip()
    return False, f"HTTP {code.strip() or '?'}: {body.strip() or out.stderr.strip()}"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--title", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--body", help="Issue description (markdown).")
    g.add_argument("--body-file", help="Path to a file with the description.")
    p.add_argument("--assignee-role", default="cto")
    p.add_argument(
        "--priority", default="high", choices=["critical", "high", "medium", "low"]
    )
    p.add_argument("--status", default="todo")
    p.add_argument("--base-url", default=DEFAULT_BASE)
    p.add_argument("--company-id", default=None)
    p.add_argument("--api-key", default=os.environ.get("PAPERCLIP_API_KEY"))
    p.add_argument(
        "--attach", action="append", default=[], help="File to upload (repeatable)."
    )
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    base = args.base_url.rstrip("/")
    body = args.body
    if args.body_file:
        with open(args.body_file, "r") as fh:
            body = fh.read()

    company = resolve_company(base, args.api_key, args.company_id)
    cid = company["id"]
    agent = resolve_agent(base, args.api_key, cid, args.assignee_role)

    payload = {
        "title": args.title,
        "description": body,
        "assigneeAgentId": agent["id"],
        "priority": args.priority,
        "status": args.status,
    }

    if args.dry_run:
        print("=== DRY RUN — nothing created ===")
        print(f"Base URL : {base}")
        print(f"Company  : {company.get('name')} ({cid}) prefix={company.get('issuePrefix')}")
        print(f"Assignee : {agent.get('name')} role={agent.get('role')} ({agent['id']})")
        if args.attach:
            print(f"Attach   : {', '.join(args.attach)}")
        print("Payload  :")
        print(json.dumps(payload, indent=2))
        return

    status, issue = _req(
        "POST", f"{base}/api/companies/{cid}/issues", args.api_key, data=payload
    )
    if status not in (200, 201) or not isinstance(issue, dict):
        die(f"Create failed (HTTP {status}): {issue}")
    issue_id = issue.get("id")
    identifier = issue.get("identifier") or issue.get("number")
    print(f"Created task {identifier or issue_id} (id={issue_id})")
    print(f"  Title    : {args.title}")
    print(f"  Assignee : {agent.get('name')} ({agent.get('role')})")
    print(f"  Company  : {company.get('name')} [{company.get('issuePrefix')}]")

    for path in args.attach:
        if not os.path.exists(path):
            print(f"  WARN: attachment not found, skipped: {path}", file=sys.stderr)
            continue
        ok, msg = upload_attachment(base, args.api_key, cid, issue_id, path)
        if ok:
            print(f"  Attached : {os.path.basename(path)}")
        else:
            print(f"  WARN: attach failed for {path} ({msg})", file=sys.stderr)

    # Emit a machine-readable line last for the calling skill to parse if needed.
    print(json.dumps({"issueId": issue_id, "identifier": identifier, "companyId": cid}))


if __name__ == "__main__":
    main()
