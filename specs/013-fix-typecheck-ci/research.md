# Research: Typecheck and CI Reliability

## Decision 1: CI platform and triggers

- **Decision**: Use GitHub Actions with triggers on pull_request and push to the default branch.
- **Rationale**: The feature request explicitly calls for a GitHub Actions workflow that runs on PRs and pushes, and this keeps the automation aligned with existing GitHub-based development flow.
- **Alternatives considered**: Other CI providers (not selected because the requirement is specific to GitHub Actions).

## Decision 2: Typecheck tool

- **Decision**: Keep the current typecheck tool and command (tsgo --noEmit via @typescript/native-preview) as the required standard.
- **Rationale**: This is an explicit requirement in the spec and ensures local and automated validation remain aligned.
- **Alternatives considered**: Replace with TypeScript tsc --noEmit (rejected because it conflicts with the requirement).

## Decision 3: Quality gate composition

- **Decision**: Run quality check, typecheck, tests, and build as separate required CI steps.
- **Rationale**: The spec requires the quality check to run as its own required step and to fail the overall run if any step fails.
- **Alternatives considered**: Rely on build to cover quality checks (rejected because separate step is required).

## Decision 4: Forked pull request security posture

- **Decision**: Run automated validation for forked PRs with read-only permissions and no secrets.
- **Rationale**: This matches the clarified requirement and aligns with GitHub Actions security best practices for untrusted code.
- **Alternatives considered**: Skip validation for forks (rejected because validation is required for PRs).
