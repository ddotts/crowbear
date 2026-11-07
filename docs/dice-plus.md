# Dice+ bridge contract

The `@crowbear/dice-plus` workspace package wraps the public
[Dice+ integration protocol](https://extensions.owlbear.rodeo/dice-plus#extension-integration)
using the [Owlbear Broadcast API](https://docs.owlbear.rodeo/extensions/apis/broadcast/).
Dice+ is installed separately and must be enabled in the same room.

Create a client with a unique, stable source ID per extension. Call it only after
`OBR.onReady`. The sandbox uses `com.ddotts.crowbear.sandbox`.

| Method                                         | Behavior                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `isReady(timeoutMs = 1000)`                    | Correlates a readiness reply; returns false on timeout                                                   |
| `validateNotation(notation, timeoutMs = 1000)` | Returns the parsed validation response, including any error position                                     |
| `roll(options)`                                | Gets the current player, sends a request, and resolves the full typed result or rejects a matching error |

Roll options require `diceNotation`, `rollTarget`, and `showResults`. The audience
is `everyone`, `self`, `dm` (GM and self), or `gm_only`. The bridge forwards it
unchanged; the sandbox lets Dice+ display results rather than exposing totals
in its own UI. Consumers must respect audience restrictions when displaying or
persisting returned data. The result channel is not an authentication boundary.

The default roll timeout is 60 seconds, overridable per call with `timeoutMs`.
Timeouts reject with `DicePlusTimeoutError`; send failures propagate to callers.
There are no automatic retries: retrying a roll could roll twice. Listeners and
timers are removed on completion, send failure, or timeout. Each operation
subscribes before sending and matches its request or roll ID, so concurrent
calls and readiness-request echoes do not interfere.

Zod validates incoming responses, including nested groups and dice, before
returning typed data. Unrelated or malformed messages are ignored until a valid
matching response or timeout. The adapter consumes documented fields; additional
upstream fields are not part of its returned contract. Condensed groups preserve
their aggregation markers. Dice+ owns notation parsing and result calculation.

## Upstream caveats

Reviewed on 2026-11-07. The integration schema names the final result
`result.totalValue`, while a multi-roll paragraph calls it `total`. The bridge
follows the explicit integration schema and examples and does not invent an alias.
Use `totalValue` for Dice+'s computed total; do not reconstruct arithmetic from
the sum of dice groups.

Dice+ mentions a 64 KB broadcast limit; the Owlbear Broadcast API documentation
currently says 16 KB. Crowbear does not assume the larger limit. Very large
requests/results and live GM-only routing require real-room verification.
No external Dice+ implementation is vendored here.
