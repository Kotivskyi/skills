#!/usr/bin/env python3
"""
Fetch PR conversation comments, reviews, and inline review threads with thread state.

Requires:
  - GitHub CLI (`gh`) installed and authenticated.
  - Either current branch has an associated PR, or --owner --repo --number is supplied.

Examples:
  python3 .agents/skills/gh-address-comments/scripts/fetch_comments.py
  python3 .agents/skills/gh-address-comments/scripts/fetch_comments.py --owner Pastorix-HQ --repo pastorix-docs --number 60
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from typing import Any

QUERY = """\
query(
  $owner: String!,
  $repo: String!,
  $number: Int!,
  $commentsCursor: String,
  $reviewsCursor: String,
  $threadsCursor: String
) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      url
      title
      state

      comments(first: 100, after: $commentsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          body
          createdAt
          updatedAt
          author { login }
        }
      }

      reviews(first: 100, after: $reviewsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          state
          body
          submittedAt
          author { login }
        }
      }

      reviewThreads(first: 100, after: $threadsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          diffSide
          startLine
          startDiffSide
          originalLine
          originalStartLine
          resolvedBy { login }
          comments(first: 100) {
            nodes {
              id
              body
              createdAt
              updatedAt
              author { login }
            }
          }
        }
      }
    }
  }
}
"""


def run(cmd: list[str], stdin: str | None = None) -> str:
    proc = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{proc.stderr}")
    return proc.stdout


def run_json(cmd: list[str], stdin: str | None = None) -> dict[str, Any]:
    out = run(cmd, stdin=stdin)
    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Failed to parse JSON: {exc}\nRaw output:\n{out}") from exc


def ensure_gh_authenticated() -> None:
    try:
        run(["gh", "auth", "status"])
    except RuntimeError:
        print("run `gh auth login` to authenticate the GitHub CLI", file=sys.stderr)
        raise


def current_branch_pr_ref() -> tuple[str, str, int]:
    # A review thread lives on the *base* repository, so resolve coordinates from
    # the PR url (which points at the base repo), not from headRepository. For a
    # fork PR the head repo differs from the base, and `repository(headOwner,
    # headRepo).pullRequest(baseNumber)` fetches the wrong PR or no review state.
    # `gh pr view` exposes no baseRepository field, but its url always encodes the
    # base owner/repo: https://<host>/OWNER/REPO/pull/NUMBER.
    pr = run_json(["gh", "pr", "view", "--json", "number,url"])
    number = int(pr["number"])
    match = re.match(r"https?://[^/]+/([^/]+)/([^/]+)/pull/\d+", pr["url"])
    if not match:
        raise RuntimeError(f"Could not parse base owner/repo from PR url: {pr['url']!r}")
    owner, repo = match.group(1), match.group(2)
    return owner, repo, number


def graphql_page(
    owner: str,
    repo: str,
    number: int,
    comments_cursor: str | None,
    reviews_cursor: str | None,
    threads_cursor: str | None,
) -> dict[str, Any]:
    cmd = [
        "gh",
        "api",
        "graphql",
        "-F",
        "query=@-",
        "-F",
        f"owner={owner}",
        "-F",
        f"repo={repo}",
        "-F",
        f"number={number}",
    ]
    if comments_cursor:
        cmd += ["-F", f"commentsCursor={comments_cursor}"]
    if reviews_cursor:
        cmd += ["-F", f"reviewsCursor={reviews_cursor}"]
    if threads_cursor:
        cmd += ["-F", f"threadsCursor={threads_cursor}"]
    return run_json(cmd, stdin=QUERY)


def fetch_all(owner: str, repo: str, number: int) -> dict[str, Any]:
    comments: list[dict[str, Any]] = []
    reviews: list[dict[str, Any]] = []
    threads: list[dict[str, Any]] = []
    pr_meta: dict[str, Any] | None = None

    comments_cursor: str | None = None
    reviews_cursor: str | None = None
    threads_cursor: str | None = None

    # Track each connection independently. Once a connection runs out of pages we
    # stop collecting and advancing it — without this, a connection that finished
    # while another is still paging would have its cursor reset to None, and the
    # next request (which omits that connection's `after`) would re-append its
    # first page, duplicating nodes (e.g. review_threads) on large PRs.
    comments_done = False
    reviews_done = False
    threads_done = False

    while True:
        payload = graphql_page(owner, repo, number, comments_cursor, reviews_cursor, threads_cursor)
        if payload.get("errors"):
            raise RuntimeError(f"GitHub GraphQL errors:\n{json.dumps(payload['errors'], indent=2)}")

        pr = payload["data"]["repository"]["pullRequest"]
        if pr_meta is None:
            pr_meta = {
                "number": pr["number"],
                "url": pr["url"],
                "title": pr["title"],
                "state": pr["state"],
                "owner": owner,
                "repo": repo,
            }

        comments_page = pr["comments"]
        reviews_page = pr["reviews"]
        threads_page = pr["reviewThreads"]

        if not comments_done:
            comments.extend(comments_page.get("nodes") or [])
            if comments_page["pageInfo"]["hasNextPage"]:
                comments_cursor = comments_page["pageInfo"]["endCursor"]
            else:
                comments_done = True

        if not reviews_done:
            reviews.extend(reviews_page.get("nodes") or [])
            if reviews_page["pageInfo"]["hasNextPage"]:
                reviews_cursor = reviews_page["pageInfo"]["endCursor"]
            else:
                reviews_done = True

        if not threads_done:
            threads.extend(threads_page.get("nodes") or [])
            if threads_page["pageInfo"]["hasNextPage"]:
                threads_cursor = threads_page["pageInfo"]["endCursor"]
            else:
                threads_done = True

        if comments_done and reviews_done and threads_done:
            break

    if pr_meta is None:
        raise RuntimeError(f"PR not found: {owner}/{repo}#{number}")

    return {
        "pull_request": pr_meta,
        "conversation_comments": comments,
        "reviews": reviews,
        "review_threads": threads,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch GitHub PR comments, reviews, and review threads as JSON.")
    parser.add_argument("--owner", help="GitHub repository owner or organization.")
    parser.add_argument("--repo", help="GitHub repository name.")
    parser.add_argument("--number", type=int, help="Pull request number.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_gh_authenticated()

    supplied = [args.owner is not None, args.repo is not None, args.number is not None]
    if any(supplied) and not all(supplied):
        raise SystemExit("--owner, --repo, and --number must be supplied together")

    if args.owner and args.repo and args.number:
        owner, repo, number = args.owner, args.repo, args.number
    else:
        owner, repo, number = current_branch_pr_ref()

    print(json.dumps(fetch_all(owner, repo, number), indent=2))


if __name__ == "__main__":
    main()
