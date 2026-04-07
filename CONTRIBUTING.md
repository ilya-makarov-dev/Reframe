# Contributing to reframe

Thanks for your interest in contributing to reframe.

## Contributor License Agreement

Before your first pull request can be merged, you must agree to the [Contributor License Agreement (CLA)](CLA.md). This is required because reframe is dual-licensed (AGPL-3.0 + commercial), and we need the legal right to distribute your contributions under both licenses.

By submitting a pull request, you agree to the CLA terms.

## How to contribute

1. Fork the repository
2. Create a branch for your change
3. Make your changes
4. Run `npx tsc --noEmit` to verify TypeScript compilation
5. Submit a pull request

## What we're looking for

- Bug fixes with clear reproduction steps
- Performance improvements with benchmarks
- New host adapters
- Improvements to semantic classification accuracy
- Documentation improvements

## Code style

- TypeScript strict mode
- No unnecessary abstractions — simple code over clever code
- Comments only where logic isn't self-evident
- Existing code style takes precedence

## Reporting issues

Open a GitHub issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Diagnostic log output (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) and may also be distributed under a commercial license as described in the [CLA](CLA.md).
