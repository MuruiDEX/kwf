# KWF RBAC — Access Matrix (verified against code)

Model: `ACCESS = has_perm(role/grant) AND ownership_scope`. Backend enforces;
frontend (`RequireRole`, `can()`) is UX hint only.

## Roles

`public` (incl. anonymous) → `athlete` → `coach`, `referee` (operational),
`organizer` (vetted via admin-approved request), `admin` (global).

## Action matrix

| Action | Athlete | Coach | Referee | Organizer | Admin |
|---|:---:|:---:|:---:|:---:|:---:|
| View public tournaments/brackets/results | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manage own profile | ✓ (linked) | ✓ | ✓ | ✓ | ✓ |
| Claim athlete profile (1:1) | ✓ own | — | — | — | — |
| Manage athletes | — | own only (`created_by`/`club.owner`/linked) | — | any¹ | ✓ |
| Register athletes | self (linked) | any² | — | own tournaments | ✓ |
| Approve/reject/withdraw regs | own withdraw | own withdraw | — | own tournaments | ✓ |
| Manage tournament/categories | — | — | — | own | ✓ |
| Generate brackets/schedule | — | — | — | own | ✓ |
| Correct bracket pair | — | — | — | own | ✓ |
| Weigh-in / check-in / finish / timer | — | — | global official³ | own | ✓ |
| Assign referees | — | — | — | own | ✓ |
| Issue documents/diplomas/spravki | — | own athletes | — | own/any⁴ | ✓ |
| View audit log | — | — | — | own scope | ✓ |
| Manage users / roles / grants / requests | — | — | — | — | ✓ |

¹ Organizer manages any athlete profile (vetted role; tournament-scoped
workflows use registrations). ² Open registration by design; organizer
moderates via approve/reject. ³ Referees act globally as officials (no
tatami-binding enforcement; assignment is scheduling info). ⁴ Organizer:
any athlete for issue; spravki additionally require athlete scope.

## Permissions (12, all enforced in `deps.require_perm` + ownership)

`tournaments.create/manage` (organizer+), `tournaments.manage_all` (admin,
non-grantable), `athletes.manage` (organizer/coach+), `clubs.manage`
(organizer+), `news.manage` (organizer+, global by design), `documents.manage`
(organizer+), `matches.manage` (referee/organizer+), `users.view` (admin,
grantable read-only), `audit.view` (organizer+), `roles.manage` (admin,
non-grantable), `organizer_requests.manage` (admin, non-grantable, reserved —
no endpoint enforces it yet; kept, never granted).

Grants are additive and can never bypass ownership (`UserPermission` + scope
checks). Non-grantable set can never be handed out (400).

## Safety rails

- Self-registration of `organizer`/`admin` roles rejected; organizer only via
  approved `OrganizerRequest` (admin decision never demotes an admin).
- Self role/deactivate change rejected; last active admin cannot be
  demoted/deactivated (409).
- Admin bootstrap: `ADMIN_EMAIL`/`ADMIN_PASSWORD` env-only; prod without
  credentials creates nothing; weak prod password aborts; idempotent;
  audited (`bootstrap admin created`, no secrets logged).
- Claim is athlete-role-only, 1:1, audited; concurrent claims resolve to 409.
- Unknown IDs → 404; foreign resources → 403 (no existence oracle leaks).
