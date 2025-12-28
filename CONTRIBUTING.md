# Contributing to EZPlayer

Thank you for your interest in contributing!

## Ground Rules

- The EZPlayer project is licensed under the GNU Affero General Public License v3.0 (AGPLv3).
- All contributions (code, documentation, assets, or configuration) are submitted under the AGPLv3.
- By contributing, you also grant the EZPlayer Project Steering Committee a perpetual, worldwide,
  non-exclusive, royalty-free license to relicense your contribution under **additional**
  license terms if needed for compatibility or commercial use.
- This does **not** revoke or restrict the AGPL license. The AGPL version will remain permanently available.
- You retain your own copyright; this agreement is a license grant, not a transfer.
- You represent that you have the right to make your contribution under these terms.

## Contribution Workflow

0. It may be a good idea to reach out to us to ask about interest in your contribution. Someone may already have it in progress, have ideas about the implementation, etc., and we don't want you to waste your effort.
1. Fork the repository and create a feature branch.
2. Run tests and ensure code passes linting.
3. Submit a pull request targeting the `main` branch.
4. A maintainer will review and may request changes before merging.

All pull requests are understood to include your agreement to the above contributor terms.

## Code of Conduct

Please act professionally and respectfully. Abusive, harassing, or exclusionary behavior
is not tolerated and may result in removal from the community.

## User Interface Guidelines

EZPlayer values simplicity and internal consistency. But "consistency" is always relative: one can be consistent with platform conventions, or one can be consistent across the environments in which the product actually runs. EZPlayer chooses the latter.

EZPlayer aims to present one unified interface across desktop (Windows/macOS/Linux), browser, and mobile.
This means EZPlayer will be self-consistent, but not platform-native on any specific host. All EZPlayers should look and behave the same, so that documentation, screenshots, support, training, and mental models transfer cleanly between all installations.

### No Native Menus

To preserve this consistency, there is an explicit prohibition on native menus, including:

- macOS system menus\*
- Windows/Linux app menus
- Right-click context menus

These UI surfaces do not exist in browsers or on mobile, and allowing them on the desktop creates a second interaction model that cannot be carried forward to other environments. Also, menus are a well-known "slippery slope" toward complexity in the xLights ecosystem, where there are a myriad of complex, non-discoverable, and poorly documented features accessible only on menus.

\*A minimal, hidden macOS-only menu may exist solely for required system behaviors (e.g., Copy/Paste roles), but it is not considered part of the EZPlayer UI and must never contain app-level actions.

### Minimize Settings Through Universal Design

Wherever possible, EZPlayer chooses designs that work reasonably for everyone without configuration. For example, a date like `11/12/2025` is ambiguous internationally and would require a user preference to resolve. Instead, EZPlayer uses formats such as `11-Dec-2025` (or `12-Nov-2025`), which have universal clarity. While these may not be everyone's favorite style, they ensure that screenshots, tutorials, and user-to-user communication remain consistent, reducing the support burden.

---

_For questions, the EZPlayer Steering Committee can be contacted
through the repository’s Issues page._
