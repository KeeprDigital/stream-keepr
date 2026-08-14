# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Auxiliary labels

| Label                 | Meaning                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `requires-deployment` | Blocked on a human-authorized deploy: what remains can only be verified against the deployed Worker |

`requires-deployment` composes with the roles above rather than replacing them — a ticket can be `ready-for-agent` for its local half and `requires-deployment` for its close. The rule it encodes is the round-eleven one (see `docs/agents/parallel-rounds.md`): having the credential is not authorization, so an agent finishes the local evidence, applies this label, and leaves the deploy — and the ticket's close — to a human. #302 and #189 are the founding examples.
