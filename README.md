# AMO Discord Bot

Private student/member channel automation for the Algerian Mathematical Olympiad (AMO) Discord server. Assign a trigger role → the bot creates exactly one private channel with the right permissions. Database (SQLite + Prisma) is the source of truth: `guildId + discordUserId ↔ channelId`.

## 1. What it does

- Watches `guildMemberUpdate` for configured **trigger roles** (e.g. Participant, Student).
- Creates **one** private text channel per user (idempotent, race-safe).
- Grants access to the owner + any number of **staff roles**; denies `@everyone`.
- Handles role removal (configurable policy), manual channel deletion, restart recovery, and full `/room` lifecycle management.

## 2. Requirements

- Node.js 20+
- A Discord application + bot token
- `SERVER MEMBERS INTENT` enabled (see below)

## 3–6. Discord application setup

1. Go to https://discord.com/developers/applications → New Application.
2. **Bot** → Reset Token → copy it (never commit it).
3. **Bot → Privileged Gateway Intents** → enable **SERVER MEMBERS INTENT**.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions: Manage Channels, Manage Roles, View Channels, Send Messages, Read Message History, Embed Links. Open the URL to invite the bot.
5. Copy the **Application ID** → `CLIENT_ID` in `.env`.

## 7. Required permissions

Manage Channels (create + overwrites), Manage Roles (bot role **above** staff/trigger roles in hierarchy), View/Send/Read History, Embed Links, Use Slash Commands.

## 8–9. Install & configure

```powershell
npm install
Copy-Item .env.example .env   # then fill DISCORD_TOKEN, CLIENT_ID, GUILD_ID
```

`.env` (never commit):

```
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=            # dev server id for instant command deploys; empty = global
DATABASE_URL="file:./dev.db"
```

## 10–11. Database (Prisma + SQLite)

```powershell
npx prisma migrate dev --name init
npx prisma db seed   # seeds role/category IDs migrated from legacy index.js
```

Migrating to PostgreSQL later: change `provider` to `postgresql` in `prisma/schema.prisma` and `DATABASE_URL`; no model changes needed.

## 12. Deploy slash commands

```powershell
npm run deploy   # guild-instant if GUILD_ID set, else global (~1h propagation)
```

## 13. Run

```powershell
npm run dev      # development (tsx watch)
npm run build; npm start   # production
```

## 14–16. First-server configuration

```
/setup category category:#private-rooms
/config trigger-role-add role:@Student
/config trigger-role-add role:@Participant
/config staff-role-add role:@Coach
/config staff-role-add role:@HR
/config show
```

## 17. Testing private rooms

1. Assign `@Student` to a test member → expect a channel named after their server display name, visible to them + staff only.
2. Assign a second trigger role → **no** second channel.
3. Remove one trigger role while another remains → room kept.
4. Remove all trigger roles → follows removal policy (`KEEP_CHANNEL` default; change via `/config removal-action`).
5. Restart the bot → no duplicates (startup reconciliation marks stale rows).
6. Rename the channel manually → DB still resolves it by `channelId`.
7. Delete the channel manually → DB marked `DELETED`; `/room sync` reports/repairs.

## 18. Lifecycle

`ensureRoom (CREATE/ACTIVE)` → `close` (deny Send, keep history) → `reopen` → `rename` → `delete` (requires `confirm:True`). `/room sync` and `/config sync-all` repair drift. Manual deletes are detected via `channelDelete`. Users leaving mark rooms `USER_LEFT` (history preserved).

**Running the bot only sometimes?** Every startup runs a catch-up sweep: it fetches all members and creates rooms for anyone holding a trigger role who has none (missed `guildMemberUpdate` events are never replayed by Discord, so this is how offline grants get picked up). Existing rooms are reused, never duplicated. Requires Server Members Intent.

## 19. Troubleshooting

- `DISCORD_TOKEN is missing` → check `.env`.
- No channel created → is a trigger role configured? Does the bot have Manage Channels? Is the category set? Check `[STARTUP]` warnings.
- **`Missing Permissions` / `Missing Access` when creating rooms** — fix all three in Discord:
  1. Server Settings → Roles → click the bot's role → enable **Manage Channels** (and Manage Roles).
  2. In the same Roles list, **drag the bot's role ABOVE every staff and trigger role**.
  3. Right-click the private category → ⚙ Edit Category → Permissions → make sure the bot's role is not denied View / Manage Channels there (category overwrites override server-wide grants).
  Then restart the bot and read the `[STARTUP]` warnings — it now reports exactly which of the three is wrong.
- `Used disallowed intents` → enable Server Members Intent in the portal.
- Stale rooms → run `/room sync` / `/config sync-all`.

## 20. Security

- Never commit `.env`; rotate the token if exposed (**the token previously in this repo's `.env` must be reset**).
- Admin commands require Administrator; room commands require staff role or Manage Channels.
- `/room delete` requires explicit `confirm:True`.
- Tokens/secrets are never logged.

---

Legacy `index.js` prototype has been replaced by `src/` (services, repositories, events, commands). Role/category IDs from it were seeded into the DB.
