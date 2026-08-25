# Security policy

## Supported versions

Security fixes are applied to the latest released minor version.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature on the repository Security tab. Include:

- The affected version and operating system
- Reproduction steps
- The expected and actual behavior
- Whether recordings, credentials, local files, or agent permissions are exposed

## Recording safety

Agent Demo Studio is intended for controlled product-demo environments. Do not place passwords, session tokens, payment information, customer data, or other secrets in prompts or recording scripts. Review generated recordings before sharing them.

The local Studio binds to `127.0.0.1`. Changes that expose it to other network interfaces must include authentication, origin validation, and a threat-model update.
