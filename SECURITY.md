# Security Policy

## Reporting a Vulnerability

Email: security@example.com (replace with real contact)

Do NOT open public issues for security vulnerabilities.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | ✅        |

## Security Measures

- No secrets in code — all configuration via environment variables
- SQLite databases opened read-only for Hermes data
- Config writes are Pydantic-validated with atomic writes
- Path traversal guards on all file-serving endpoints
- CI rejects commits containing .env files or private keys
