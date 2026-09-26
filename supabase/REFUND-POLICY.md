# Refund policy foundation

Wayvo's refund protection is deterministic:

```text
Journey segment + disruption facts
        -> policy rules
        -> eligibility result
        -> user review and confirmation
        -> future claim/action milestone
```

Policies are structured data in `refund_policies` and
`refund_policy_rules`. The database never stores executable code. Only
allow-listed rule types are interpreted by
`src/services/refundPolicyService.ts`.

The engine is authoritative for eligibility and can return `eligible`,
`potentially_eligible`, `not_eligible`, or `insufficient_information`. It
never invents a fare or assumes that the fare is refundable. Full-fare,
partial-fare, fixed, calculated, and unknown amount modes are represented
explicitly.

Passenger travel status is stored on the existing `journey_segments` model as
`travelled`, `not_travelled`, or `unknown`. Unknown is never silently converted
to not travelled.

AI may later explain a result or summarize evidence. AI must not decide
eligibility, interpret policy rules, set the refund amount, or authorize a
claim. This milestone stops at the private eligibility result. It does not
cancel bookings, submit TDRs, contact providers, transfer money, or create a
claim system.

Eligibility rows retain the policy name, provider, version, source, effective
date, structured evaluation inputs, missing information, required evidence,
and any amount that was deterministically calculable. RLS scopes those rows to
the owning profile and trip.