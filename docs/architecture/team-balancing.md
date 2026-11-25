# Team balancing (#67)

How the bot proposes teams, how admins edit them in one private message, and how the result is posted.

## Solver

`packages/core/src/teams/solve-teams.ts` is pure and deterministic: players are sorted by id and every restart uses a seeded
Park-Miller generator, so the same input in any order gives the same teams. 30 players into 4 teams with three proposals
takes about 35 ms.

Hard rules, kept by construction or by a weight of 10⁶ per miss: sizes at most one apart, a keeper per team when there are
enough (otherwise at most one more than the fair share), admin locks. When the local search misses sizes or keepers, a bounded
exhaustive search over the free keepers repairs it; what locks make impossible is returned as `unresolved`, and the editor names
uneven keepers plainly. Pairs together or apart are not stored: nothing wrote them, so the table and its constraints were
removed.

Objective, in this order of weights: strength spread of the teams (a short team is counted with the average player it will
borrow, "+1 from the losing team"), spread of uncertainty (players of unknown strength are not put together), the rotation
of the short team (who was short in the last three games), roles (positions and newcomers spread), the organizer's habits,
variety against the last three games, guests next to their host. Search: greedy start plus best-improvement swaps and moves,
six restarts.

Three proposals: balanced, close to past squads, and new combinations; the second and third are pushed away from the first
by a penalty per shared pair. Without levels the first proposal is the one closest to past squads and has no variety term
(variety is used only by the "fresh" one); the editor says "рівні не задані — ділю за минулими складами" and calls it
"варіант за минулими складами". It is a suggestion, never a claim to divide the way the organizer would: on the private
history it does not beat a simple baseline (see the evaluation below).
With an existing line-up the solver keeps it as an anchor and adds a penalty per moved player: late joiners are placed with
the fewest moves.

Strength: the tier an admin sets by tapping is stored as `organizer_seed` (new 3, normal 5, strong 8) and gives a prior of
μ = 25 ± 2 per level step with σ = 5; unknown players are μ = 25, σ = 25/3. The one-tap result of the evening updates
`openskill_pl` with the Weng–Lin Bradley–Terry full-pair rule (Weng and Lin, "A Bayesian Approximation Method for Online
Ranking", JMLR 12, 2011, Algorithm 1), see `rate-result.ts`. Strength and tiers are never shown in group text, logs or
assistant answers; the editor says it in words («⚖️ Сили майже рівні.»), never with numbers.

## Habits

One query reads the `team_member` rows of every earlier game of the community (imported line-ups and posted ones, one row
per person and game, so a forwarded squad counts once). `habitsOf` weighs each game by 0.5^(age in days / 120) and for each
pair compares how often the two were in one team (O) with how often chance would put them together (E = (n−1)/(N−1) for
their team sizes) over the weighted games (W):

    habit = ln((O + 1) / (W − O + 1)) − ln((E + 1) / (W − E + 1))

## Home colours (#80)

`home-colours.ts` is pure. The same history query also brings the colour of each squad (both chats, 💷 and 🔴 are one red).
Per player it takes the last 20 squads with a colour; the share of a colour is `games / (squads + 1)`. A home colour is one
worn in at least 80% of at least 8 squads; guests have none. An admin may fix one in the editor («🎽 Колір: …») or return to
«Авто»; it is stored per person and activity in `play_private.home_colour`, as confidential as the level.

- **Colours of the evening:** the most frequent set worn by that many teams in the last 50 such games of the community, else
  the most worn colours. Colours in the draft, the admin's among them, stay for the same number of teams.
- **Who wears which:** the order of the teams with the greatest total share (all permutations, 720 at six teams), except with
  locks or a placed line-up, where a player must keep his team.
- **Solver:** a home colour costs 30 in any other team (60 when fixed), below a strength difference of one point (100) and
  the cost of moving a placed player (250); habits stop counting only for a pair with a fixed colour, and a fixed player decides who wears which before shares do. A late joiner follows it too.
  On 183 real games of a year this kept the match with the organizer's pairs (43.6%, 43.4% without colours) and put 60% of the
  players, 87% of those with a home colour, in their colour. Ignoring habits for every home colour gave 38% and 53%.

The benchmark (12 players) keeps its gap to the optimum with a home colour for everyone. Over 40 synthetic games the mean
strength spread stayed 2.10 with tiers and 0.00 without levels, and went from 0.15 to 0.29 (at most 0.78, «Сили рівні» up to 1.5)
with learned ratings; home colours were met for 90%, 95% and 62% (31%, 30% and 38% before). Median time of three proposals on a busy machine:

| Players / teams | without homes | a home for everyone |
| --------------- | ------------- | ------------------- |
| 14 / 2          | 2 ms          | 2 ms                |
| 20 / 3          | 15 ms         | 17 ms               |
| 26 / 4          | 34 ms         | 50 ms               |
| 30 / 4          | 62 ms         | 40 ms               |
| 36 / 6          | 82 ms         | 78 ms               |

For an offline check call `affinitiesOf(rows, players)`, `coloursFor(rows, teamCount)` and
`solveColoured(input, { colours, affinities })` with rows earlier than the game only; the teams come in the order of the colours.

## Offline evaluation

`evaluateTeams(rows, last = 65)`, a test helper in `packages/core/test/support/evaluate-teams.ts`, replays a history: for each of the last games it learns habits from
earlier rows only, proposes teams with the same team count and compares them with what the organizer did. Rows are plain
objects, one per player per game:

| field      | type      | meaning                                                   |
| ---------- | --------- | --------------------------------------------------------- |
| `game`     | string    | any id that is the same for all rows of one game          |
| `date`     | string    | `YYYY-MM-DD`, orders the games                            |
| `team`     | number    | team number within the game, 1-based (0 is ignored)       |
| `player`   | string    | any stable player id                                      |
| `strength` | number?   | optional, the same scale as μ (25 = normal)               |
| `isGk`     | boolean?  | optional keeper flag                                      |

Results on the private history (335 squads of both groups, run by the owner outside the repository):

| Games evaluated | Pair match | Random pair match | Median moves to the real teams |
| --------------- | ---------- | ----------------- | ------------------------------ |
| last 65         | 40.3%      | 32.3%             | 7                              |
| last 150        | 42%        | —                 | 7                              |
| last 65 / 150, without variety | 41.8% / 42.8% | — | 7                       |

Other weights, a plain log ratio and a 365-day half-life did not help. A simple habit baseline reached 45% on a slightly
different sample, so habits carry little and the acceptance bar "beats the baseline" is not met: proposals stay suggestions
until levels and results exist.

It returns the share of the organizer's same-team pairs the solver also put together (`pairMatch`, against the analytic
random baseline `randomPairMatch`), the median number of players to move from the proposal to the real teams
(`medianMoves`), the mean strength spread of proposals and of the real teams, and one row per game. The owner's history
stays outside the repository; export the rows from a local database and call the function from a script there.

## Draft, editor and posting

One `play.team_draft` row per game holds the teams, colours, locks, keepers, players not yet placed, the three proposals
and five undo steps. Every change is an update `where version = ?`; a tap on an older version is told apart: the same
admin's repeated tap is ignored, another admin's change is shown with "the teams were changed by another admin". Callback
data is `t:<game>:<version>:<page>:<op>:<args>`, at most 64 bytes, and every tap checks the admin and the game's community.

The first screen (the hourly proposal, the card's 👕 Склади) is the line-up exactly as it goes out, «Поки нічого не
надіслано» and four rows: ✅ Надіслати в «X» (several destinations are listed in the text and the button says ✅ Надіслати),
✏️ Змінити склади, 🔀 Інший варіант (n з 3) with ➕ Хтось прийшов, and ⬅️ До гри. ✅ sends at once: it carries a fingerprint of
the chats, topics and text shown; under the community lock the plan is made again, and a different fingerprint sends nothing
and shows the fresh line-up naming what changed. The editor shows team titles as words with counts («🔴 Червоні · 7»), names
as «Vasyl T.» (longer only for clashes, guests «Lev P. +1»), and only worded buttons: ↩️ Скасувати останнє after a change,
🔀 Перемішати (… інших with a lock), ➕ Хтось прийшов, ⚙️ Рівні та кольори and 👌 Готово back to the line-up with «Що змінилося».
A selected player turns the other titles into ➡️ до Синіх and offers 🧤 Воротар, 🔒 Не чіпати, 🚫 Не грає (a removal before the
kick-off, «не прийшов» or «прибрати» after it; a promotion from the queue is named first), ➕ Гість від Vasyl and ✖️ Скасувати
вибір. A full game asks ⏳ Додати в чергу or ➕ Додати понад ліміт; queued players are listed «У черзі» and never counted.
`play.lineup_delivery` keeps one claim and receipt per destination and `team_draft.publish_token` one publish of the game at a
time: each send is one bounded Telegram call with its own receipt, a refusal or timeout in one group never touches another, a
claim younger than a minute is busy, and an unknown result gets its own ✅ Немає, надіслати в «X». The post has a bold header,
«🔴 <b>Червоні · 7</b>» per team and one player per line, with «(+1 з команди, що програла)» on a short team only when three
or more teams play (with two there is nobody to borrow from); only messages the bot sent are edited. For the admin's own chat the
clean message to forward is the newest one and the instruction is on the screen above it; after a first post a new message
is headed "Оновлені склади". After the kick-off the card shows only the game and asks «Як зіграли?» with 🏆 per team and
🤝 Нічия, then «Записав: …» and ↩️ Змінити результат. Right after a send the screen keeps one receipt line per destination.
A stored squad seeds the draft with its players who never signed up (no bot poll); a sign-up that is out still removes one.

Private texts follow the admin's language from their last update (stored on every message and tap), Ukrainian when it
is unknown; group texts use the community's configured language.

The result of the evening is one tap on the card after the start; a second tap the same evening (until start + 12 h)
corrects it by reverting the rating events of that game, unless a later game has already rated those players.

Proposals are only as good as levels and results, so after the third game with teams and no level at all the editor
offers once, quietly, "Хочеш рівніші команди? Познач сильних, це один дотик" with «Не зараз»; it is not offered to the same
admin again for 30 days.

Only real Telegram can prove that text mentions survive a forward and whether an edit notifies again.



## Before the game

`/api/cron/teams` runs `runTeamsTick` once an hour at :00, 13–20 UTC on weekdays and 9–20 UTC on weekends
(`apps/web/vercel.json`). The proposal goes out at the last hourly check that is at least `settings.teams.leadMinutes`
(default 60) before the start, so 60 to 119 minutes before it: a 19:00 game at 18:00, an 18:30 game at 17:00, a 19:30 game
at 18:00 (the organizer's own median is 104 minutes). The hours cover weekday starts from 14:00 to 21:59 UTC and weekend
starts from 10:00 to 21:59 UTC, which is where the community's games are (weekday evenings, weekend days); a game outside
them still has its editor on the card. Never for cancelled games, games whose teams exist, or fewer than eight players (a
gentle note instead). Claims are single updates, so a retried or doubled check sends once; a moved game is judged by its
current start; after a missed hour the next check still sends while the game has not started. A game on the hour whose
only due check is missed gets no automatic proposal (the next check is at its start).

Late changes need no cron. Every vote marks the draft changed, and the vote itself sends the quiet note to the admins
when five minutes have passed since the last one, and at once from 15 minutes before to 15 minutes after the start. A
change held back by the five-minute pause goes out with the next vote, the next tap of an admin in that game, or the next
hourly check; a vote that changes nothing does not use up the pause. The card and the editor always show the current
state. ✅ in the note accepts the fewest moves, and re-sends when the teams were already posted.

Cost on Neon's free plan (0.25 CU minimum, suspended after 5 idle minutes): 8 checks on a weekday and 12 on a weekend day
are 64 a week, about 278 a month. A check that finds the database asleep keeps it awake about 5 minutes:
278 × 5/60 h × 0.25 CU ≈ 5.8 CU-hours a month at most, less when a check falls into time the votes already keep awake.
The daily maintenance adds about 30 × 5/60 × 0.25 ≈ 0.6. A store outside Postgres (Vercel Runtime Cache, Global Config)
or Vercel Queues would wake the database only when needed, but an hourly check is precise enough and needs no new
product or dependency.
