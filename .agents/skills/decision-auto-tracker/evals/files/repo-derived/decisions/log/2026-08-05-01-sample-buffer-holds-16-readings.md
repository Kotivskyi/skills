---
id: 2026-08-05-01
date: 2026-08-05
topic: sample-buffer-holds-16-readings
bucket: design
tags: [firmware, sensors]
linear:
supersedes:
---

# Sample buffer holds 16 readings

## Decision

The accelerometer sample buffer holds **16 readings** before a flush. The flush runs on the sensor thread.

## Context

Bring-up showed the 8-reading buffer flushed too often and woke the radio thread every 200 ms.

## Reasoning

16 readings keep the flush interval under one second and fit the remaining RAM budget.

## Source

User in conversation, 2026-08-05: "Make it 16, we have the RAM."
