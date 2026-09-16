---
name: bdd-implement
description: >
  Implement Behavior-Driven Development scenarios — turn Given-When-Then
  scenarios into executable tests. Use when writing step definitions or glue
  code, wiring Gherkin feature files to Cucumber/Jest/Vitest/Playwright/Cypress,
  implementing the steps behind a scenario via TDD, and making BDD scenarios
  pass. To author the scenarios first, use the `/bdd-create` skill.
---
# BDD: Implement Scenarios

Turn approved BDD scenarios into running tests. This skill covers the **execution** side: step definitions, framework glue, and driving each scenario from red to green with TDD.

It assumes scenarios already exist. To discover and author Given-When-Then scenarios and acceptance criteria first, use the `/bdd-create` skill.

## When to Use

- Writing step definitions / glue code for existing scenarios
- Wiring Gherkin feature files to a test runner (Cucumber, Jest/Vitest, Playwright/Cypress)
- Implementing the behavior behind a scenario via TDD
- Making BDD scenarios pass and verifying acceptance criteria are met

## Implementation Workflow

For each scenario produced by `/bdd-create`:

```
1. Write the step definitions (glue code) that map Given/When/Then to runner calls
2. Implement the steps using TDD:
   - Write the failing assertion (RED)
   - Implement the behavior (GREEN)
   - Refactor (REFACTOR)
3. Run the scenario and verify it passes
4. Repeat until every scenario passes and all acceptance criteria are met
```

Keep step definitions thin: they translate the scenario's business language into calls against the system. Push real logic into the application or shared helpers, not the steps.

## Tools Integration

**Gherkin/Cucumber:**
```bash
# Feature files in features/ directory
features/
├── authentication.feature
├── user_profile.feature
└── payment.feature
```

**Jest/Vitest:**
```javascript
describe('User Authentication', () => {
  it('should login with valid credentials', () => {
    // Given
    const user = createUser({ email: 'user@example.com', password: 'SecurePass123' });

    // When
    const result = login(user.email, 'SecurePass123');

    // Then
    expect(result.success).toBe(true);
    expect(result.redirectTo).toBe('/dashboard');
  });
});
```

**Playwright/Cypress:**
```javascript
test('User can login successfully', async ({ page }) => {
  // Given
  await page.goto('/login');

  // When
  await page.fill('[name="email"]', 'user@example.com');
  await page.fill('[name="password"]', 'SecurePass123');
  await page.click('button[type="submit"]');

  // Then
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('.welcome')).toBeVisible();
});
```

## Verification

- Every scenario in the feature file passes
- Every item in the acceptance criteria checklist is satisfied
- Scenarios remain independent and can run in any order

## Integration Points

- **`/bdd-create`:** Source of the scenarios and acceptance criteria implemented here
- **TDD (test-driven):** Each scenario's steps are driven red → green → refactor
- **Documentation:** Passing scenarios serve as living, executable documentation
