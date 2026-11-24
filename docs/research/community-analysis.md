# Community analysis

Source: a full export of the community's Telegram group, June 2023 to November 2026. The analysis
ran locally. **Raw data is not stored in this repo**; this document contains only anonymized
aggregates and paraphrased patterns. No member names, nicknames, contacts or payment details.

## Dataset

| | |
|---|---|
| Period | 2023-06-01 → 2026-11-23 (~3.5 years) |
| Messages | 18,192 (≈15,500 user messages, ≈2,700 service events) |
| Distinct authors | 213 |
| Group size | ~50 → ~200 members |
| Game polls | 559 (99% posted by one organizer) |
| Posted team line-ups | 210 |
| Location pins | 13 |
| Organizer's share of messages | 28.9% |

Telegram's HTML export doesn't include poll vote counts or voter names. Attendance is reconstructed
from the posted line-ups, which use nicknames rather than Telegram accounts (see *Identity*).

## Games

- **Cadence:** Monday and Friday are the core days (178 and 175 polls), with Tuesday, Wednesday or Thursday as overflow and extra slots. 111 polls in 2023 (from June), 171 in 2024, 133 in 2025 and 144 in 2026.
- **Start time:** 19:00 dominates (313 polls), then 19:30, 18:30, 20:00 and 17:30. End times are hard at some venues because the next group arrives.
- **Capacity per poll:** 18 (one field, 3 teams of 6) is the most common cap, then 28 and 24 (two fields), 15 (indoor futsal) and up to 36 or 42 (three fields).
- **Players per game** (from line-ups): median 21, 10th percentile 15, 90th percentile 27.
- **Teams per game:** 3 teams in 60% of games, 4 teams in 30%, and 2 or 6 teams occasionally.
- **Signup mechanism:** the native Telegram poll "+ / −" (388 polls), "+ / Who's there?" for reserve polls (46), and ✔️ / 🙅 or ✅ / ❌ variants. Also multi-option polls for time slot, venue or format.

## Venues

| Venue (public) | Use | Notes |
|---|---|---|
| U3 Kendlerstraße (14th district) | "Our main field", 231 polls | Outdoor, several fields of different sizes, numbered changing rooms and key from the clubhouse, no parking (cars allowed in only at set times), hard end time before the club's own training or league matches, free cancellation. |
| Sportcenter Donaucity, U1 Alte Donau (22nd) | 116 polls, mainly Fridays | Numbered fields; 8x8, 5x5 and a cold hall; cancellation fee within 24h; ID needed for keys; parking ~€2. |
| UniCredit Sportcenter am Kaiserwasser (22nd) | Since Dec 2025 | Often confused with Donaucity (same U1 stop); 1–3 fields; caps 21–42. |
| School gym, 14th district | Winter futsal (Tuesdays) | Strict entry time, indoor shoes, cap 15, cancelled during school holidays. |
| Winter halls (parquet or turf) | Seasonal | Booked case by case; often only 2–4 week windows. |
| League grounds (Stadlau and others) | Competitive Sunday matches | Not organized through the casual polls. |

**Pattern:** venue, field count, time and cap change week to week, sometimes on the same day.
People repeatedly went to the wrong venue after a late change.

## Pain points (by frequency and impact)

1. **Poll fragility.** People can't find out how to change a vote, remove a "+" silently instead of voting "−", vote on the wrong option in multi-option polls, or miss the poll because they muted the noisy chat. The organizer re-forwards polls to bump them and asks for silence after posting.
2. **Reserve and waitlist done by hand.** "First N are in, the rest are reserve." Spots that open up are announced in chat and the reserve is pinged by name. There are informal priority rules: reserve last time gets priority next time, and held slots for specific people.
3. **Guests without Telegram.** Up to 8 of 24 players in a game; counted manually as "+1", "not on Telegram", or as a whole "foreign specialists" team, sometimes prepaid.
4. **Go/no-go decisions.** Second field confirmed or dropped by a venue deadline (14:00–21:00 the day before or of); weather (rain, snow, heat, thunderstorms); holidays and school holidays; venue closures. Min and max thresholds are applied by gut feeling.
5. **Match-day logistics:** 229 messages asking about changing rooms, fields, keys or addresses, and 205 "I'm running late" messages. Key handling and changing-room conduct put venue access at risk more than once.
6. **Money.** Price per person changed €7 → €8 → €10, with goalkeepers at €5 and the school hall at €5. Payment is cash at the field via a designated collector, or SEPA to the organizer before the game. Unpaid players are chased by hand. The rules tightened over time: pay before the game; cancelling after 14:00 on game day or not showing means paying in full. Event costs (BBQ) are split by receipts.
7. **Team balancing** is manual, by memory. Captains' picks were tried and abandoned. There were occasional formal imbalance complaints. Goalkeepers are pinned per team, pairs of friends are kept together, and newcomers are placed by self-declared level.
8. **No results or stats** for casual games, beyond a few hand-written round-robin tables. League results are posted as text or video. Players repeatedly ask for stats, live scores and video highlights.
9. **Equipment and lost and found.** Bibs (team colours) and balls go missing, with dozens of "who forgot this?" photos.
10. **Rules live in long chat posts:** footwear (no studs, by vote), sliding tackles, ball retrieval, free kicks, rotation ("max 2 wins in a row; draw → longer-playing team leaves"), swearing, dispute resolution in 5 seconds. Newcomers don't see them.

## Identity

- Line-ups use first names and nicknames: 628 distinct aliases. 24 appear 50 or more times, 36 appear 20–49 times, 73 appear 5–19 times, and 493 appear 1–4 times.
- There are duplicates ("two people with the same first name"), descriptive suffixes (weight, profession, hometown), and placeholders for guests.
- A stable player ID that maps aliases to a Telegram account (or to a guest without one) is a prerequisite for any stats.

## Community beyond the game

- **Competitive teams:** the community runs teams in an ÖKFB small-field league (several divisions, a second team, a 35+/40+ veterans team), cups and indoor tournaments, with prize money and award ceremonies.
- **Other activities:** basketball, beach and indoor volleyball, table tennis, boxing, kids' camps, BBQs with cost splitting, watch parties, trips.
- **Social glue:** birthday posts (174 messages), a hall of fame (lifetime free play), merch, sponsored ads (paid from 2027 to fund prizes).
- **Noise:** football banter, classifieds (flats, cars, jobs) and media make up most of the volume. The organizer moderates ads.

## Implications for requirements

| Finding | Epic |
|---|---|
| Poll fragility, waitlist, guests | E03, E04 |
| Venue changes, logistics questions | E05, E06 |
| Aliases, guests, roles | E02, E15 |
| Pay-before rule, cancellation fees, collectors | E07 |
| Manual balancing, GK pinning, pairs | E08 |
| No casual stats, rotation formats | E09, E11 |
| Desire for feedback, MVP, recognition | E10, E12 |
| League squads and tournaments | E13 |
| Other sports and stand-in organizers | E14 |
| Rules posts, ads, noise | E16 |
