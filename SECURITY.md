# Security Policy

## Reporting a Vulnerability

Report security vulnerabilities via [GitHub Issues](https://github.com/Bendak/hermes-agentos/issues).

Do NOT open public issues for security vulnerabilities — use a private channel if possible.

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
