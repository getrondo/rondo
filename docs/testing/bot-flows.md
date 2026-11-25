# Bot flows

One row per flow. `Test` names the test that proves it; `flow-matrix.test.ts` fails when a row that is not planned has no
test of exactly that name. Layer: `update` runs Telegram updates through `handleUpdate` with the recorded Telegram API and
PGlite, `service` calls the domain service, `cron` runs the maintenance job, `unit` a pure function.

Only a real test group can prove what the recorder cannot: that Telegram accepts the poll description and route button,
that a forwarded poll keeps its description, route button and votes, that stopPoll on the original closes the forwarded
copies, pinning rights, and delivery of chat member updates.

| # | Area | Flow | Trigger and steps | Group gets | Admin gets | Stored | Layer | Test |
|---|---|---|---|---|---|---|---|---|
| 1 | CREATE | Usual game in 2 taps | /newgame → ✅ | Poll with place block | Preview, then game card with ✅ | Game, poll, poll ref | update | `posts the usual Friday game with two taps and shows its card` |
| 2 | CREATE | Other likely game | /newgame → tap the second candidate → ✅ | Poll for that game | Preview swaps in place | Game | update | `swaps to the usual Monday, adds places, changes time and place, and keeps Back on every list` |
| 3 | CREATE | Quick fix: time from the list | 🕖 → time | — | Time list (✓ current), back to preview | Draft | update | `swaps to the usual Monday, adds places, changes time and place, and keeps Back on every list` |
| 4 | CREATE | Quick fix: ±30 minutes | 🕖 → 18:00 or 19:00 around 18:30 | — | Half an hour around the current time is offered | Draft | update | `swaps to the usual Monday, adds places, changes time and place, and keeps Back on every list` |
| 5 | CREATE | Quick fix: place | 📍 → one of the top 3 | — | Place list with Other and New, size of that place | Draft | update | `swaps to the usual Monday, adds places, changes time and place, and keeps Back on every list` |
| 6 | CREATE | Quick fix: day from the list | 📅 → day | — | Usual days first, today last while its time is ahead | Draft | update | `picks another day from the list, sets no limit, types the size and refuses a time that has passed today` |
| 7 | CREATE | Quick fix: size ± | 👥 − / 👥 + | Poll says the new number | Middle button shows the value | Game capacity | update | `swaps to the usual Monday, adds places, changes time and place, and keeps Back on every list` |
| 8 | CREATE | Quick fix: no limit | 👥 22 → ♾ | Poll without places | 👥 ♾ | Game capacity empty | update | `picks another day from the list, sets no limit, types the size and refuses a time that has passed today` |
| 9 | CREATE | Typed values | 🕖 / 📅 / 👥 list open → type 20:15, 5.12, 25 | — | Back to preview | Draft | update | `types another time, an unusual date and a new place with its pin, and refuses the past` |
| 10 | CREATE | Manual path | 🛠 → day → place → time → size → 💾 | Nothing | Each step, then preview with 💾 | Game without poll | update | `walks the manual steps and creates a game without a poll` |
| 11 | CREATE | New place with a pin | 📍 → ➕ → name → location | Poll with route button | Pin prompt with ⏭ | Training place with coordinates | update | `types another time, an unusual date and a new place with its pin, and refuses the past` |
| 12 | CREATE | New place with a Google Maps link | 📍 → ➕ → name → link | Poll with route from the link coordinates | Pin prompt | Place with link and coordinates | update | `creates a new place from a Google Maps link` |
| 13 | CREATE | New place without a pin | 🛠 → ➕ → name → ⏭ | Poll without route | — | Place without address | update | `walks the manual steps and creates a game without a poll` |
| 14 | CREATE | Missing address hint | 📍 Адреса → typed address | Poll description with the address | Hint disappears | Place address | update | `adds the missing address from the preview hint and shows it in the poll` |
| 15 | CREATE | No group linked | /newgame without /link | Nothing | Says how to link; only 💾 | Game without poll | update | `discards a draft with ✖️ and offers only a game without a poll when no group is linked` |
| 16 | CREATE | Same day, game without a poll | /newgame when that game exists | Poll of the existing game | 📣 Опублікувати опитування | Poll ref of that game | update | `warns about a game on the same day and offers the poll of a game without one` |
| 17 | CREATE | Same day, game with an open poll | Candidate skips the day; 📅 to it warns | — | Warning on the preview | — | update | `warns about a game on the same day and offers the poll of a game without one` |
| 18 | CREATE | Today and the past refused | Typed past date, typed past time today | — | Reason shown, value kept | — | update | `picks another day from the list, sets no limit, types the size and refuses a time that has passed today` |
| 19 | CREATE | Too little history | /newgame in a new community | — | Friendly text and the day list | Draft | update | `starts with the manual steps when there is too little history` |
| 20 | CREATE | Draft expiry | Tap ✅ after 31 minutes | Nothing | Toast: screen is outdated | No game | update | `keeps two admins apart, consumes ✅ once and refuses an expired or revoked draft` |
| 21 | CREATE | Back and Home | ⬅️ on every list, 🏠 on cards | — | Same message edited | — | update | `edits one message through games, card, Back and Home, and ignores an unchanged message` |
| 22 | CREATE | Cancel | ✖️ | Nothing | Home screen | Draft removed | update | `discards a draft with ✖️ and offers only a game without a poll when no group is linked` |
| 23 | CREATE | Two admins at once | Two drafts, both ✅ | Two polls | Each sees their own draft | Two games | update | `keeps two admins apart, consumes ✅ once and refuses an expired or revoked draft` |
| 24 | CREATE | Double tap on ✅ | Same ✅ twice | One poll | Second tap: outdated | One game | update | `keeps two admins apart, consumes ✅ once and refuses an expired or revoked draft` |
| 25 | CREATE | Revoked admin mid-flow | Role ends, then ✅ | Nothing | No longer an admin | No game | update | `keeps two admins apart, consumes ✅ once and refuses an expired or revoked draft` |
| 26 | CREATE | AI gateway down | /newgame flow, then free text | Poll as usual | Menu works; text gets the AI error | Game | update | `works while the AI gateway is down and hands other text to the assistant` |
| 27 | CREATE | Telegram refuses the poll | ✅ with sendPoll refused | Nothing | What to do; draft kept for ✅ again | No game until the retry | update | `keeps the draft when Telegram refuses the poll and says what to do` |
| 28 | CREATE | Telegram does not answer | ✅ with a network error | Unknown | Check the group before repeating | No game | update | `reports an uncertain poll when Telegram does not answer and keeps the game when pinning is refused` |
| 29 | CREATE | Pin refused | ✅ without the right to pin | Poll, not pinned | Game card | Game | update | `reports an uncertain poll when Telegram does not answer and keeps the game when pinning is refused` |
| 30 | CREATE | Ukrainian and Russian | uk and ru admins | Group language | Admin language | — | update | `posts the poll of a game without one, cancels with a notice and publishes teams without levels` |
| 31 | CREATE | Preview equals the poll | Preview vs sendPoll | Question, answers, description, route | Same text in the preview | — | update | `shows the same question, description and route in the preview as in the poll` |
| 32 | AUDIENCE | One linked chat | /newgame | Poll in that chat | No audience button | — | update | `posts the usual Friday game with two taps and shows its card` |
| 33 | AUDIENCE | Second chat | /newgame on Tuesday → ✅ | Poll in the second group only | ➡️ Second beside ✅ | Poll ref in the second chat | update | `posts the usual Wednesday to the second group in two taps` |
| 34 | AUDIENCE | Both chats | /newgame → ✅ | Poll in one, forward in the other | ➡️ Games + Second | Two poll refs, one poll | update | `posts the Friday to both groups as one poll and one forward, and counts a vote from the copy once` |
| 35 | AUDIENCE | Open later from the card | Card → 📣 Відкрити ще для → ✅ | Forward of the open poll | Free places on the card | Poll ref in the new chat | update | `opens a full game to the second group later, reports a refused forward and mentions the promoted player in both` |
| 36 | AUDIENCE | Forward refused | forwardMessage refused | Nothing new | Reason on the card; button stays | No ref | update | `opens a full game to the second group later, reports a refused forward and mentions the promoted player in both` |
| 37 | AUDIENCE | /link a second group | /link slug in another group | Linked message | — | Second chat, first stays default | update | `adds a group with /link and moves the topic inside one group` |
| 38 | AUDIENCE | Move the topic | /link slug in another topic of the same group | Linked message in the topic | — | Topic updated | update | `adds a group with /link and moves the topic inside one group` |
| 39 | VOTES | Yes | Poll answer 0 | — | — | Sign-up in | update | `counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention` |
| 40 | VOTES | No | Poll answer 1 | — | — | Sign-up out | update | `counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention` |
| 41 | VOTES | Change | 1 then 0 | — | — | Sign-up in | update | `counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention` |
| 42 | VOTES | Withdraw | Empty answer | — | — | Sign-up out, seat freed | update | `counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention` |
| 43 | VOTES | Full goes to the waiting list | Vote over the limit | — | — | Waitlisted | update | `counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention` |
| 44 | VOTES | Promotion mention | A seat frees | Mention of the promoted player | — | Promoted to in | update | `counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention` |
| 45 | VOTES | Several accounts of one person | Two accounts of one person vote | — | — | One sign-up | update | `gives the last place to one of two votes arriving together and counts two accounts of one person once` |
| 46 | VOTES | Vote from a forwarded copy | Answer with the same poll id | — | — | One sign-up | update | `posts the Friday to both groups as one poll and one forward, and counts a vote from the copy once` |
| 47 | VOTES | New person | Unknown Telegram user votes | — | — | Person and membership | update | `counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention` |
| 48 | VOTES | Not yet a member | Voter never wrote in the group | — | — | Active membership | update | `counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention` |
| 49 | VOTES | Same update twice | Telegram retries an update | — | — | Applied once | update | `ignores an unknown poll, a repeated update and votes after the game is cancelled` |
| 50 | VOTES | After the game is closed | Vote on a cancelled game | — | — | Nothing | update | `ignores an unknown poll, a repeated update and votes after the game is cancelled` |
| 51 | VOTES | Unknown poll | Answer to a poll the bot did not send | — | — | Nothing | update | `ignores an unknown poll, a repeated update and votes after the game is cancelled` |
| 52 | VOTES | Order of updates | yes, withdraw, no, yes | — | — | Last answer wins | update | `applies poll answers in the order Telegram delivers them` |
| 53 | VOTES | Concurrent votes for the last place | Two answers at once | — | — | One in, one waitlisted | update | `gives the last place to one of two votes arriving together and counts two accounts of one person once` |
| 54 | MEMBERS | Join | Member joins | — | — | Active membership | update | `follows joins and kicks from member updates and ignores bots` |
| 55 | MEMBERS | Leave | Member leaves | — | — | Membership left | update | `follows a member who writes, leaves, rejoins, renames and changes the username` |
| 56 | MEMBERS | Rejoin | Member joins again | — | — | Active again | update | `follows a member who writes, leaves, rejoins, renames and changes the username` |
| 57 | MEMBERS | Rename | New first name in a message | — | — | Display name follows | update | `follows a member who writes, leaves, rejoins, renames and changes the username` |
| 58 | MEMBERS | Username change | New username | — | — | Username follows | update | `follows a member who writes, leaves, rejoins, renames and changes the username` |
| 59 | MEMBERS | Bot not admin | No member updates arrive | — | — | Members learned from messages | update | `follows a member who writes, leaves, rejoins, renames and changes the username` |
| 60 | ADMIN AFTER | Card numbers | /games → game | — | Signed, free places, waiting list, keepers | — | update | `opens a full game to the second group later, reports a refused forward and mentions the promoted player in both` |
| 61 | ADMIN AFTER | Change with and without notice | Card → 🕖/📍/👥 → confirm | Notice only when asked, with place block | Exact group text before ✅ | Game updated | update | `changes time with a notice, place quietly and the size, each after one confirmation` |
| 62 | ADMIN AFTER | Cancel with notice | Card → ✖️ → reason → ✅ сообщить | Cancellation with mentions | Exact group text | Game cancelled, poll closed | update | `posts the poll of a game without one, cancels with a notice and publishes teams without levels` |
| 63 | ADMIN AFTER | Cancel without notice | cancel_session notify off | Nothing | — | Game cancelled | service | `posts a change or a cancellation in the group only when asked` |
| 64 | ADMIN AFTER | Teams preview and post | Card → 👕 → 2 → ✅ | Line-up without levels | Exact group text | Teams | update | `posts the poll of a game without one, cancels with a notice and publishes teams without levels` |
| 65 | ADMIN AFTER | Refused post | Line-up refused by Telegram | Earlier line-up stays | Reason | Earlier teams kept | service | `keeps the posted teams when Telegram refuses new ones` |
| 66 | ADMIN AFTER | Close the poll at game time | Daily cron | Poll closed | — | Poll closed_at | cron | `tries again to close the polls of finished and cancelled games` |
| 67 | ADMIN AFTER | Finish and attendance | Daily cron after the game | — | — | Played, attendance | cron | `fills sign-ups player by player when there is no line-up, and a manual outcome wins` |
| 68 | ADMIN AFTER | Uncertain result | Telegram does not answer | Unknown | Check the group first | Action failed as uncertain | update | `reports an uncertain poll when Telegram does not answer and keeps the game when pinning is refused` |
| 69 | GROUP SOURCE | Organizer's own poll | Admin posts a poll in the topic | — | — | Game | update | `binds the topic of /link, reads games only there and posts there` |
| 70 | GROUP SOURCE | Squad | Admin posts a line-up | — | — | Line-up entries | service | `turns a poll and a line-up into session data and only suggests a cancellation` |
| 71 | GROUP SOURCE | Cancellation proposal | Admin writes a cancellation | — | Proposal with ✅/❌ | Cancelled only after ✅ | update | `asks the admin privately before a cancellation written in the group is applied` |
| 72 | GROUP SOURCE | Unknown place | Admin poll with an unknown place | — | Create-place proposal | Place after ✅ | update | `syncs members and proposes an unknown venue to the admin who posted the poll` |
| 73 | GROUP SOURCE | Venue pin | Admin sends a venue | — | — | Place with coordinates | update | `binds the topic of /link, reads games only there and posts there` |
| 74 | GROUP SOURCE | Non-admin posts ignored | Member writes a cancellation | — | — | Nothing | update | `asks the admin privately before a cancellation written in the group is applied` |
| 75 | GROUP SOURCE | Other topic ignored | Poll in another topic | — | — | Nothing | update | `binds the topic of /link, reads games only there and posts there` |
| 76 | ASSISTANT | Every propose tool | Mock model calls each tool | — | Proposal | Pending action of the right kind | service | `builds the right action for every propose tool` |
| 77 | ASSISTANT | Confirm | act:…:y | As the action | Done | Action result | update | `lets the owner link the group, create a game through the assistant, confirm it and collect sign-ups` |
| 78 | ASSISTANT | Reject | act:…:n | Nothing | Rejected | Rejected | update | `rejects, expires and refuses a foreign confirmation button` |
| 79 | ASSISTANT | Expired | Tap after 30 minutes | Nothing | Time is up | Expired | update | `rejects, expires and refuses a foreign confirmation button` |
| 80 | ASSISTANT | Foreign user's button | Another user taps | Nothing | Nothing changes | Still proposed | update | `rejects, expires and refuses a foreign confirmation button` |
| 81 | ASSISTANT | Text while a menu is open | Free text on a list | — | Assistant answers; list still works | Draft kept | update | `hands text that is not a value to the assistant while a list is open` |
| 82 | SECURITY | Non-admin commands and taps | /newgame and a menu tap by a member | — | Short refusal | Nothing | update | `answers members without the menu and refuses a game of another community in callback data` |
| 83 | SECURITY | Foreign ids in callback data | Card of another community | — | Game not found | Nothing | update | `answers members without the menu and refuses a game of another community in callback data` |
| 84 | SECURITY | Wrong webhook secret | Request without the secret | — | — | 401 | unit | `rejects a missing or different secret` |
| 85 | SECURITY | HTML escaping | Names and places with <, & and quotes | Escaped in poll description, notices, line-ups, mentions | — | — | update | `escapes names and places in every text posted to the group` |
| 86 | SECURITY | Levels never in group text | Teams posted | No level or strength | Strength only in the private preview | — | service | `publishes line-ups with names, colours and the place, never levels, and mentions a promoted player` |
| 87 | PLANNED | Live list of signed players | — | — | — | — | — | planned #33 |
| 88 | PLANNED | Who has not answered | — | — | — | — | — | planned (issue to file) |
| 89 | PLANNED | Repost of an organizer's poll | — | — | — | — | — | planned #51 |
| 90 | PLANNED | Morning digest | — | — | — | — | — | planned #31 |
