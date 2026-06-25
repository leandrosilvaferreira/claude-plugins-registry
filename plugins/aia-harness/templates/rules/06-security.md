---
paths:
  - "**/*"
---

# Security

## Objective

Apply security by default in every change, preventing data leaks, authorization failures, insufficient validation, and secret exposure.

## Do

- Validate inputs at all system boundaries.
- Treat every external input as untrusted.
- Use allowlists where possible.
- Normalize and validate data before processing.
- Apply encoding or escaping appropriate to the output context.
- Use parameterized queries or the ORM's secure mechanisms.
- Verify authentication before accessing protected resources.
- Verify authorization on the backend, not only in the interface.
- Validate permissions by user, organization, tenant, role, or scope where applicable.
- Apply least privilege to accesses, tokens, credentials, and services.
- Protect sensitive data in logs, errors, and responses.
- Never expose secrets, tokens, private keys, or credentials.
- Use environment variables or a secret manager for secrets.
- Use safe error messages for end users.
- Include sufficient context in internal logs without leaking sensitive data.
- Protect endpoints against unauthorized cross-tenant access.
- Validate resource ownership before reading, modifying, or deleting.
- Consider rate limiting, idempotency, and abuse protection on critical endpoints.
- Use appropriate encryption for sensitive data when necessary.
- Don't store passwords in plain text.
- Use password hashing with an appropriate algorithm when the project handles authentication.
- Validate size, type, and content of uploads.
- Treat uploaded files as untrusted content.
- Avoid dynamic execution of code, commands, or string-concatenated queries.
- Review new dependencies before adding them.
- Prefer mature and maintained libraries.
- Preserve audit trails for sensitive actions.
- Ensure tests cover authorization and data isolation where applicable.

## Don't

- Don't trust data coming from the frontend.
- Don't rely solely on client-side validation.
- Don't build SQL, shell commands, expressions, or paths with unsafe concatenation.
- Don't expose stack traces to end users.
- Don't log passwords, tokens, documents, keys, cookies, or sensitive data.
- Don't put secrets in source code.
- Don't put secrets in versioned files.
- Don't skip authorization because the endpoint is "already hidden".
- Don't allow access to a resource by ID alone without validating ownership.
- Don't use broad permissions without necessity.
- Don't add an unknown dependency without justification.
- Don't disable security validations to resolve an error quickly.
- Don't ignore authentication, authorization, or cryptography failures.
- Don't save sensitive data without a clear need.
- Don't return more data than necessary.
- Don't expose internal infrastructure details in public messages.
- Don't accept uploads without size limits and validation.
- Don't use homegrown cryptographic algorithms.
- Don't treat security as a later step.

## Acceptance criteria

- External inputs are validated.
- Authorization is verified on the backend.
- No sensitive data leaks in logs, errors, or responses.
- Secrets do not appear in code.
- Queries and commands are not built in an insecure way.
- Cross-tenant or cross-user access is protected.
- Critical changes have tests for permissions, validation, and failure.
