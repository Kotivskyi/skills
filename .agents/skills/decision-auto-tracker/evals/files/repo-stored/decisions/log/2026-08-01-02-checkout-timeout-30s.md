---
id: 2026-08-01-02
date: 2026-08-01
topic: checkout-timeout-30s
status: active
tags: [checkout, behavior]
linear:
supersedes:
---

# Checkout session timeout is 30 seconds

## Decision

A checkout session times out after **30 seconds** of payment-provider silence. The user sees a retry screen.

## Context

The payment provider occasionally stalls. Without a timeout the spinner ran until the browser gave up.

## Reasoning

30 s is the provider's own documented p99 for a successful callback.

## Source

User in conversation, 2026-08-01: "30 seconds, then show the retry screen."
