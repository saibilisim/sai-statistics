# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on
this repository. If that is not possible, email **support@saistatistics.com**
with "SECURITY" in the subject.

Include what you found, how to reproduce it, the affected version (Help ▸
About) and the platform. We acknowledge reports within 5 working days and keep
you informed until the issue is fixed. We are happy to credit you in the
release notes unless you prefer otherwise.

## Supported versions

Security fixes go into the latest release. Official builds update themselves;
please update before reporting.

## Scope

In scope: the desktop application in this repository — the Electron main and
renderer processes, the preload/IPC surface, the R bridge, file import/export,
the R terminal's isolation guarantees and the AI integration's data-leak rules
(see [CLAUDE.md §9](CLAUDE.md#9-security-non-negotiable)).

Out of scope here (report them the same way, but they are not fixed in this
repository): the saistatistics.com website and the SAI account / AI service
servers.

Not vulnerabilities by design:

- Code you run yourself in the R terminal can do anything R can do. The
  barrier is that nothing runs without your explicit action (CLAUDE.md §9,
  rule 2), not a sandbox around R.
- Builds made from source, or downloaded from anywhere other than
  saistatistics.com and the Microsoft Store, are not signed by SAI Bilişim.
