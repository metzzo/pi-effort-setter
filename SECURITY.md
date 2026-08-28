# Security policy

## Supported versions

Security fixes are provided for the latest published version.

## Reporting a vulnerability

Do not include exploit details, credentials, or other sensitive information in a public issue.

Use the repository host's private vulnerability-reporting feature when it is available. Otherwise, contact the maintainer listed on the npm package page and ask for a private reporting channel.

Include the affected version, Pi and Node.js versions, operating system, impact, and minimal reproduction steps. Please allow time for the report to be investigated before public disclosure.

## Security model

Pi extensions run with the user's full filesystem and process permissions. This extension reads and writes only its state directory under Pi's configured agent directory and does not perform network requests. Review the source before installing any Pi extension.
