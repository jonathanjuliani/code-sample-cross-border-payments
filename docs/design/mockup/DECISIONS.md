# Design decisions

The mockup in [`index.html`](index.html) implements everything below. Open it in a browser; the simulation rail beside the app forces each provider behaviour, speeds up the timers, and shows the server log and the ledger for the open payout.

## Direction

An operations tool for a small business paying a supplier abroad. The person at the screen is at a desk, on a laptop, between other work. They know bank transfers, not wallets or tokens, and the screen never asks them to learn. The visual language is warm and editorial rather than "fintech dashboard": paper-toned backgrounds, near-black ink, one deep indigo accent, medium-weight headings with tight tracking, and monospace only where something is a reference, a time or a step number. Low density, low motion, numbers first. Desktop 1280 wide first; it works down to 375.

What they care about, in order:

1. How much the supplier gets.
2. When it lands.
3. Whether they can trust what the screen says.

Constraints that win over taste:

- AA contrast minimum on every text pair, in both themes. Where a colour in the system fails as text, it stays as a line or fill and a darker text step is added (see [Tokens](#tokens)).
- Tabular figures on every amount.
- Colour is never the only signal: every state has a word, and banners lead with a symbol and a label (`✓ DELIVERED`, `↺ REFUNDED IN FULL`).
- The amount on the confirm screen is the amount delivered. Nothing on screen says "Delivered" until the server says so.
- No crypto vocabulary in the main flow. "Funds moving to Mexico", not "on-chain transfer". The network reference lives under "Details for support".
- Light and dark from the start, plus a System / Light / Dark switch in the side nav.

References were read from shipped flows only: bank wire screens, consumer remittance apps and B2B payment tools. What they agree on: show the recipient amount first, show the fee as its own line, show the rate as "1 USD = X", give a delivery estimate, and keep a timeline per transfer. No concept shots.

### Signature patterns

These carry the look. Keep them when building components:

| Pattern            | Where                                       | Rule                                                                                                  |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Side nav           | Every screen                                | Sticky, 232px. Active link: accent text on accent-soft, 2px accent left border, mono step number.    |
| Page head          | Top of every screen                         | Uppercase accent eyebrow, medium-weight title, muted lede, a soft warm-and-cool glow behind it, a rule under it. |
| Section head       | Card titles ("Summary", "Status")           | Title with a 2px ink rule under it. Used once per card.                                              |
| Uppercase label    | Field legends, table headers, `dt`s         | 12px, semibold, 0.06em tracking, `text-subtle`.                                                      |
| Callout            | Every state banner and inline warning       | 3px left border in the state colour, state-soft fill, uppercase key line, then a bold line and a body. |
| Ring-dot timeline  | Payout status                               | A 2px rule on the left, a ring per step; mono "01 · Done · 4:42:31 PM" above the title.              |
| Pills              | Status in lists and page heads              | 12px semibold, full radius, a dot in the current colour.                                             |
| Mono               | IDs, times, step numbers, the hold countdown, currency codes beside inputs | Never for amounts. Amounts are the sans with tabular figures.                  |

## Structure

Three screens and no modals, beside a side nav (All payouts, New payout, the funding account and the theme switch).

1. **Payouts**: the list, newest first, with recipient, amount received, amount sent and status. This is also where the person lands after closing the tab.
2. **New payout**: recipient, amount and summary on one screen. Confirm lives in the summary card.
3. **Payout**: the amount the supplier gets, the facts (sent, rate, fee, started), one banner for the current state, a timeline with one row per hop, and a collapsed "Details for support".

Names used on screen: Payout, Recipient, They receive, You send, Rate, Fee, Delivered, Refunded, Not sent.

### Why quote and confirm share one screen

The rate is held for 60 seconds. A separate review page spends part of those seconds on navigation and makes "go back and change the amount" a round trip. On one screen, editing the amount drops the quote and the person asks for a new one.

### Why "They receive" is the default

A supplier sends an invoice in pesos. The person owes 42,800.00 MXN, not "roughly $2,500". In receive mode the peso amount is exact and the dollar amount is rounded up, so the supplier never gets a cent less than quoted. "You send" is the other tab for people with a dollar budget.

## States on screen

| Server state                     | Pill        | Banner                                                                                          |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| collecting, transferring, paying_out | In progress | "In progress. Expected by 4:57 PM." and "You can close this page. The status is saved."     |
| any leg is checking              | Checking    | "Confirming where your funds are." and "Don't send this payout again."                          |
| refunding                        | Refunding   | "Couldn't deliver. Refunding you." with the reason and the full amount coming back.             |
| delivered                        | Delivered   | The peso amount, the account and the time it arrived.                                           |
| failed                           | Not sent    | The reason and "No money left your account and nothing was charged."                            |
| refunded                         | Refunded    | The reason, the amount returned including the fee, and "The supplier received nothing."         |

## Recovery screens

| Case                                 | Pattern                                                                                                                                         | Why                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Rate about to expire                 | The hold bar turns to the warning colour at 10 seconds: "Rate held for 8s. Confirm now or get a new rate."                                      | The person decides with the time left visible, not after it ran out.                                                      |
| Rate expired before confirm          | The summary dims, "This rate expired at 4:42:31 PM. Nothing was sent and nothing was charged." and one button: "Get a new rate".                | Saying what did not happen is what makes it safe to try again.                                                            |
| Confirm reached the server too late  | Same card, "The rate expired before your confirmation reached us."                                                                              | The server clock decides. The client countdown is a display, not a rule.                                                  |
| New rate differs                     | A warning line above the summary: "New rate. You now send $2,494.01 (was $2,493.63)."                                                           | A changed number gets named, never swapped silently.                                                                      |
| Double click on Confirm              | The button locks and reads "Sending…". The request carries one key per quote, so even two requests make one payout.                             | The lock is for the person, the key is for the money.                                                                     |
| Provider timed out (unknown outcome) | Warning row: "The network hasn't answered yet. We're checking before doing anything else. Nothing will be sent twice."                          | An unknown outcome is its own state. No Retry button, because a blind retry is how money moves twice.                     |
| Slow hop                             | After a while on one row: "Taking longer than usual. Nothing is wrong yet."                                                                     | Waiting is not failing. Say so before the person starts worrying.                                                         |
| Hop 1 declined                       | Error banner: "Not sent. Your bank declined the debit. No money left your account."                                                             | Nothing moved, so the message is short and final.                                                                         |
| Hop 3 rejects bank details           | Hop 3 row fails, a fourth row "Refund to your account" appears, banner: "Refunded in full… Check their bank details before sending again."      | The sender gets everything back, fee included. The next action is named.                                                  |
| Can't reach the API                  | A warning strip on every screen: "Can't reach the server right now… This is the last status we confirmed, at 4:43:10 PM." The timeline freezes. | The screen never guesses. It shows the last confirmed state and when it was confirmed.                                    |
| Tab closed mid-payout                | The list shows the true status; opening the row picks up the timeline where the server is.                                                     | The client holds no state that matters. Everything comes from the API.                                                    |

## Timeline copy

| Hop | Title                               | In progress                                              | Done                                   | Failed                                                          |
| --- | ----------------------------------- | -------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| 1   | Dollars collected from your account | "Requesting $2,493.63 from ••••2290"                     | "Collected $2,493.63 · 4:42:31 PM"     | "Your bank declined the debit. No money moved."                 |
| 2   | Funds moving to Mexico              | "Sending", then "Confirming (2 of 3)"                    | "Arrived · 4:43:10 PM"                 | Never shown as failed to the person: it ends in a refund.       |
| 3   | Pesos deposited to ••••4821         | "The supplier's bank is processing the deposit"          | "42,800.00 MXN deposited · 4:44:02 PM" | "The bank rejected the account details. Nothing was deposited." |
| ↺   | Refund to your account              | "Returning $2,493.63, fee included, to ••••2290"         | "Refunded $2,493.63 · 4:45:40 PM"      | —                                                               |

Rows that will not run after a final state read "Not needed" with a dashed marker.

## Tokens

Two layers, as CSS custom properties at the top of [`index.html`](index.html):

- **Primitives** (`--p-*`): the raw values, named for what they are (`--p-paper-1`, `--p-indigo-700`). Components never use them.
- **Roles**: the only names components use (`--surface`, `--text-muted`, `--caution-soft`). Dark mode swaps role values under `prefers-color-scheme` and `[data-theme="dark"]`; no name changes.

### Type

Figtree (400, 500, 600, 700) for everything, JetBrains Mono (400, 500) for references. Figtree's tabular figures are checked: "0000" and "1111" render at the same width.

| Role          | Size | Weight | Use                                          |
| ------------- | ---- | ------ | -------------------------------------------- |
| `--fs-label`  | 12   | 600    | Uppercase labels, pills, mono meta           |
| `--fs-meta`   | 14   | 400    | Hints, secondary lines, nav links            |
| `--fs-body`   | 16   | 400    | Body                                         |
| `--fs-lede`   | 18   | 400    | Page lede, primary button                    |
| `--fs-title`  | 21   | 500    | Card titles                                  |
| `--fs-page`   | 32   | 500    | Page title, amount input                     |
| `--fs-hero`   | 48   | 500    | The peso amount on a payout, -0.02em         |

### Colour roles

| Role                          | Light                     | Dark                      | Contrast (text on its pair)          |
| ----------------------------- | ------------------------- | ------------------------- | ------------------------------------ |
| `bg` / `surface`              | `#F7F4EF` / `#FBF9F6`     | `#121211` / `#1C1B19`     | —                                    |
| `surface-hover`               | `#F0ECE5`                 | `#24231F`                 | —                                    |
| `border` / `border-strong`    | `#E6E1D9` / `#8D8A83`     | `#2E2C29` / `#4A4743`     | strong 3.3:1 on surface (inputs)     |
| `text`                        | `#141414`                 | `#F1EEE8`                 | 16.8 / 16.2                          |
| `text-muted`                  | `#4B4A46`                 | `#BCB8B0`                 | 8.1 / 9.5                            |
| `text-subtle`                 | `#6F6C66` *               | `#A3A099`                 | 4.8 / 7.2                            |
| `accent` (+ `focus-ring`)     | `#0B0C9C`                 | `#A6A8F7`                 | 12.9 on surface / 7.8                |
| `accent-soft`                 | `#E9E9F6`                 | `#23244D`                 | accent on it: 11.3 / 6.7             |
| `on-accent`                   | `#FFFFFF`                 | `#0B0C4A`                 | 13.6 / 8.2                           |
| `success` (text)              | `#2A6E4C` *               | `#74C79D`                 | 5.3 on soft / 7.5                    |
| `success-line` / `-soft`      | `#2F7A55` / `#E6F1EA`     | `#74C79D` / `#142A1F`     | —                                    |
| `caution` / `-soft`           | `#8A5A00` / `#FBF1DC` *   | `#E9B95C` / `#33270F`     | 5.3 / 8.0                            |
| `danger` (text)               | `#A83B18` *               | `#F2875F`                 | 5.5 on soft / 6.1                    |
| `danger-line` / `-soft`       | `#D9532B` / `#FBEBE3`     | `#F2875F` / `#3A1E14`     | —                                    |
| `disabled-text` / `-bg`       | `#4B4A46` / `#E6E1D9`     | `#BCB8B0` / `#2E2C29`     | 6.8 / 7.0                            |

\* Added to the base palette, everything else is taken as is. Why each one exists:

- `#8D8A83` is 3.1:1 on the page, so it fails as small text. It stays as `border-strong` and a darker grey, `#6F6C66` (4.8:1), becomes `text-subtle` for labels.
- `#D9532B` is 3.5:1 on its tint. It stays as `danger-line` (borders, timeline dots) and `#A83B18` (5.5:1) carries danger text.
- `#2F7A55` on its tint is 4.49:1, a hair under AA. It stays as `success-line` and `#2A6E4C` (5.3:1) carries success text.
- The base palette has one warm alert colour. Payouts need two different meanings: "checking / refunding / expired" (wait, nothing is wrong yet) and "not sent" (it failed). Amber is the one hue added, for `caution`; the orange keeps `danger`.

### State → role

| Meaning                                   | Role       |
| ----------------------------------------- | ---------- |
| In progress, informational                | `accent`   |
| Delivered, done                           | `success`  |
| Checking, refunding, refunded, rate expired, rate changed, offline | `caution` |
| Not sent, declined, confirm failed        | `danger`   |

### Spacing, shape, motion

- **Spacing**: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- **Targets**: 44px minimum; Confirm is 56px and full width in its card.
- **Radius**: 6 (nav links, small controls), 8 (cards, inputs, buttons, tables), 14 (reserved for large panels), full for pills and the mode toggle.
- **Motion**: 150ms on hover, 250ms linear on the hold bar, none under reduced motion. The spinner on an active row is the only thing that keeps moving.

## Mockup simplifications

- Three saved recipients. Adding or editing a recipient is not designed.
- The simulation rail sits beside the app so the mockup stays one file. In the app it is a separate `/ops` route, and the sender's screens have no controls.
- The server, the providers and the ledger are an in-memory object in the page. A reload starts over; "Close the tab and come back" in the rail simulates the real thing by discarding all client state.
- Polling every second instead of server-sent events.
- One funding account, no balance check, no login.
- Fonts load from a font CDN here. The app self-hosts them (see the plan).
- The theme choice is kept in `localStorage` when the browser allows it, and for the visit otherwise.
- The rate jitters a little per quote; the 2% move is a switch in the rail.
