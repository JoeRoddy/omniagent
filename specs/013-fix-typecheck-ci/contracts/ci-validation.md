# Contract: CI Validation Workflow

## Trigger Events

- Pull request opened or updated against the default branch.
- Push to the default branch.

## Required Steps (in order)

1. Quality check
2. Type verification (typecheck command)
3. Test suite
4. Build verification

## Inputs

- Repository source at the commit under validation.

## Outputs

- Visible pass/fail status for each required step.
- Overall workflow status fails if any required step fails.

## Security Constraints

- For pull requests from forked repositories, the workflow runs with read-only permissions and does not access secrets.

## Error Handling

- The workflow stops and reports failure if any required step fails.
