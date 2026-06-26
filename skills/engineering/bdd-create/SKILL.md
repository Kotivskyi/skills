---
name: bdd-create
description: >
  Author Behavior-Driven Development scenarios and acceptance criteria — the
  specification side of BDD, with no implementation. Use when defining
  acceptance criteria for a feature, discovering scenarios with stakeholders,
  translating requirements into Given-When-Then, writing Gherkin/Cucumber
  feature files, or producing executable specifications to approve before any
  code is written. To turn the resulting scenarios into running tests, use the
  `/bdd-implement` skill.
---
# BDD: Create Scenarios

Author BDD scenarios and acceptance criteria. This skill covers **what** a feature should do and **how users interact with it** — expressed in business language, independent of any test framework. It produces specifications, not test code.

To wire the scenarios you write here into executable tests (step definitions, Cucumber/Jest/Playwright glue, TDD), use the `/bdd-implement` skill.

## When to Use

- Defining acceptance criteria for a feature
- Discovering scenarios with stakeholders
- Translating requirements into testable Given-When-Then scenarios
- Writing Gherkin/Cucumber feature files
- Creating executable specifications to approve before implementation

## Overview

BDD bridges the gap between business requirements and technical implementation using natural-language scenarios. This skill stops at the specification: concrete, reviewable scenarios that a stakeholder can sign off on and that later become tests.

## Process

### 1. Discovery Phase

Work with stakeholders to discover scenarios:

**Ask:**
- What is the business value?
- Who are the users/actors?
- What are the main scenarios?
- What can go wrong?
- What edge cases exist?

### 2. Scenario Definition

Write scenarios in Given-When-Then format:

```gherkin
Feature: User Authentication

  Scenario: Successful login with valid credentials
    Given a registered user with email "user@example.com" and password "SecurePass123"
    When the user submits the login form with correct credentials
    Then the user should be redirected to the dashboard
    And the user session should be created
    And the user should see a welcome message

  Scenario: Failed login with invalid password
    Given a registered user with email "user@example.com"
    When the user submits the login form with incorrect password
    Then the user should see an error message "Invalid credentials"
    And the user should remain on the login page
    And no session should be created

  Scenario: Account lockout after multiple failed attempts
    Given a registered user with email "user@example.com"
    And the user has failed to login 4 times
    When the user submits the login form with incorrect password again
    Then the account should be locked for 15 minutes
    And the user should see "Account temporarily locked"
```

### 3. Examples and Data Tables

Use examples for multiple test cases:

```gherkin
  Scenario Outline: Password validation
    Given a user registration form
    When the user enters password "<password>"
    Then the validation should show "<result>"

    Examples:
      | password    | result                          |
      | abc         | Too short (min 8 characters)   |
      | abcdefgh    | Missing uppercase letter       |
      | Abcdefgh    | Missing number                 |
      | Abcdefg1    | Valid                          |
      | Abc123!@#   | Valid                          |
```

### 4. Acceptance Criteria Checklist

For each feature, create acceptance criteria:

```markdown
## Acceptance Criteria

- [ ] User can login with valid email and password
- [ ] Invalid credentials show appropriate error
- [ ] Account locks after 5 failed attempts
- [ ] Locked account shows lockout duration
- [ ] Session expires after 24 hours
- [ ] Logout clears session properly
- [ ] Remember me keeps session for 30 days
```

## BDD Scenario Structure

### Given (Context)
- Initial state
- Preconditions
- Setup data
- User context

### When (Action)
- User action
- System event
- API call
- Trigger

### Then (Outcome)
- Expected result
- State changes
- Side effects
- Assertions

### And/But (Additional steps)
- Multiple givens, whens, or thens
- Additional context or assertions

## Best Practices

**DO:**
- Write from user's perspective
- Use business language, not technical jargon
- Focus on behavior, not implementation
- Keep scenarios independent
- Use concrete examples
- Cover happy path and edge cases

**DON'T:**
- Include implementation details
- Make scenarios too long (>5-7 steps)
- Create dependencies between scenarios
- Use vague language
- Test technical details (use unit tests)

## Output Format

**BDD Scenarios File:**
```
Save to: features/<feature-name>.feature
Or: docs/bdd/<feature-name>.md

Include:
- Feature description
- User stories
- Scenarios (Given-When-Then)
- Examples/data tables
- Acceptance criteria checklist
```

## Error Handling

- **Ambiguous scenarios:** Ask for clarification
- **Too technical:** Refactor to business language
- **Missing edge cases:** Suggest additional scenarios
- **Conflicting requirements:** Flag for stakeholder review

## Next Step

Once scenarios are written and approved, hand off to the `/bdd-implement` skill to write step definitions and make the scenarios pass.

## Integration Points

- **SDD (spec-driven):** Specs define what, BDD scenarios define how users interact
- **Task Management:** Each scenario can become a task
- **Documentation:** Scenarios serve as living documentation
