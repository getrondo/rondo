# Runbook: adding the bot to a group

Nothing is posted in a group until the organizer (the approver) allowed that group once and taps ✅ for each post.

## Before the first group (owner)

1. Decide about backups again and take a dump, see [deploy-bot](deploy-bot.md#back-up-and-restore).
2. Register the webhook again, because `my_chat_member` is a new update (the command is in [deploy-bot](deploy-bot.md#deploy)).
3. The organizer must be an admin (the load refuses anyone else) and must have opened the bot once. Otherwise nothing is posted and the owner is told.
4. Write the private file outside the repository, readable by its owner only (`chmod 600`):

   ```json
   {
       "slug": "<community-slug>",
       "approverTgUserId": 123456789,
       "chats": [
           { "chatId": -1001, "title": "Main", "purpose": "main", "weekdays": ["mon", "fri"], "topicId": 5 },
           { "chatId": -1002, "title": "Second", "purpose": "other", "weekdays": ["wed"] }
       ]
   }
   ```

   `topicId` is optional. Weekdays preselect the group in `/newgame` while no game was posted yet. A chat that has matches too
   is also in `otherChats` of the import config. Load it, after asking the owner because it writes to production:

   ```bash
   isec run getrondo prod -- sh -c 'RONDO_GROUPS_FILE=<private file> pnpm -F @rondo/ingest-telegram groups'
   ```

5. In @BotFather, `/setprivacy` must be **Disable**, so the bot hears the group.

## Кроки для організатора

1. Відкрий бота в особистих повідомленнях і натисни «Почати».
2. У групі: назва групи → **Додати учасників** → обери бота. Потім **Адміністратори** → бот → увімкни **Закріплення повідомлень**.
   Бот нічого не напише в групу.
3. Бот напише тобі в особисті: «Мене додали в …». Натисни **✅ Так, підключити**. Якщо ігри живуть в окремій темі, натисни
   **🧵 Обрати тему** і напиши в тій темі будь-яке слово.
4. Поки що режим «тільки мені»: усе приходить тобі, у групу нічого не йде.
5. Коли захочеш: **/menu → 👥 Групи** → група → **📣 Писати в групу після мого ✅**. Кожне повідомлення все одно чекатиме на твій ✅.
6. Передумати можна будь-коли: **👤 Писати тільки мені**. Помилкова група: **✂️ Відключити групу**, потім **🚪 Вийти з групи**.
7. Якщо щось готує інший адміністратор, тобі прийде точно те, що він хоче надіслати: **✅ Надіслати**, **✏️ Змінити** або
   **✖️ Не надсилати**.

## What happens

- **Unknown group:** nothing is linked, posted or stored. The owner is told once per group, three times a day at most, with 🚪 to leave.
- **Removed or no longer an admin:** the approver is told and the group is back to "only me".
- **Waitlist mentions:** off until the approver turns on **🔔 Кликати з резерву без мене** in that group.
- **Opening a group** drops the open proposals for that group: what was prepared before needs a fresh approval.
- **The approver** is one Telegram account. Loading another one voids the requests the old one still had. Only the approver can
  approve a merge of the person behind that account.
- **Closing a poll** closes every forwarded copy, also one the bot never saw. A copy in a linked group needs the approver's ✅. The
  nightly job closes a cancelled game's poll only after such a ✅, and a played game's poll when the poll or its forward got the ✅ in
  every linked group it is in. It closes nothing where posting is off. When it leaves a poll open it tells the approver once per
  game (the owners when there is none) and does not try again: the button there closes that poll, also where posting is off.
- **Imports:** linking the main group sets `org.community.live_since`. After that the importer needs
  `RONDO_ACKNOWLEDGE_LIVE=true` and refuses games after that day, so export only older messages. Unlinking keeps the date.
  Clear it by hand only when the group was linked by mistake and nothing was recorded live.
- **Rollback:** a release before this one posts to every linked group without asking. Unlink all groups before rolling back.
- **A group that becomes a supergroup** keeps its link, topic and settings. If the bot was offline at that moment, load the private
  file with the new id and add the bot again.
