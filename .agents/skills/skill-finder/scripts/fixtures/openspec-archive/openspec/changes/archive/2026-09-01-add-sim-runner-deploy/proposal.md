## Why

The sim runner is deployed by hand. Each deploy takes an hour and the steps
live in chat history only.

## What Changes

- Add a deploy script for the sim runner.
- Add a staging health check after each deploy.
- Post the Grafana dashboard links when the deploy ends.
- Document the rollback steps.

## Impact

- Affected code: `scripts/deploy-sim.sh`.
