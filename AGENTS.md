
# COMGRAF CRM — Engineering Rules

## Project identity
CRM for a Honduran printing business.
This is an operational CRM, not an accounting or ERP system.

## Architecture
- Keep frontend, backend and database responsibilities separated.
- Preserve existing architecture unless a documented migration is approved.
- Avoid unnecessary dependencies.
- Prioritize low-resource deployment on Debian and Docker.

## Business rules
- A client can have multiple solicitudes.
- A solicitud can have multiple production orders (OP).
- A solicitud remains in the client history even when closed or cancelled.
- Keep solicitud status separate from OP status.
- Do not duplicate business rules across frontend and backend.
- Preserve existing production and delivery workflows.

## Production orders
- OP printing format: landscape, media carta.
- Multiple products must not overflow the OP template.
- Each OP must retain its correct client and production information.
- Do not change established OP fields without approval.

## Database
- MySQL is the database.
- Preserve existing records and schema compatibility.
- Never execute destructive migrations without explicit approval.
- Never use production data for experiments.

## Infrastructure
- Target: Debian + Docker.
- Server has limited hardware resources.
- Do not introduce unnecessarily heavy services.
- Never deploy automatically.
- Never modify production configuration without approval.

## Engineering rules
- Inspect dependencies before changing files.
- Identify redundant code before removing it.
- Add regression tests for business logic changes.
- Validate frontend and backend compatibility.
- Document architectural decisions.
- Keep maintenance instructions understandable for humans.

## Git safety
- Never commit, push, merge or deploy without authorization.
- Never discard user changes.
- Explain the impact of modifications before applying risky changes.

## Default workflow
1. Inspect.
2. Explain findings.
3. Propose a plan.
4. Obtain approval for significant changes.
5. Implement.
6. Test.
7. Document.
8. Report modified files and remaining risks.
