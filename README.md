# Morning List

A working prototype for Denise, who runs a commercial refrigeration repair company. Built for the Gushwork FDE assignment.

Live: https://morninglist.sidstack.in

Login: `denise@example.com` / `coldline-49a658` (a sample login with example jobs loaded)

## What Denise asked for

> "Who to call today, and where each job is at. Waiting on quote, waiting on their yes, scheduled, done. That is it."

Requests reach her through her cell, a website form, texts, referrals and a notebook. Nothing reminds her to follow up, and a missed Friday callback cost her a $2,000 freezer job.

## What it does

- **Today** is the one screen: who to call and why, most urgent first, then where each job is at in her own words with a count for each.
- **Two buttons per job**: Call, and "What happened?". She picks what happened from a short list and the job moves itself.
- **New job**: a short form (business, contact, phone, what is wrong). As an option she can paste a text and AI fills the form in for her to check, including flagging equipment that is down.
- **Jobs**: every job grouped by where it is at, a search box, and the numbers her husband asks for (open jobs, quotes out, done this month).
- **Website form** (`/request`): requests land on the list by themselves.
- **Morning email**: the same call list by email at 7 am her time, each person with a tap-to-call number. Help has a button to send it straight away.
- **Tour**: a guided walk-through that lights up one button at a time. It runs once on the first visit and again from the Tour button.
- **Login**: one email and password.

## When a job goes on the call list (`src/rules.js`)

| Order | Job is | She sees |
|---|---|---|
| 1 | New, equipment down | "Walk-in freezer down. Came in 3 days ago. Nobody has called back." |
| 2 | New, not called | "New request, came in today. Not called yet." |
| 3 | Said yes, not scheduled | "Said yes. Needs scheduling." |
| 4 | Waiting on quote for a day or more | "Waiting on your quote for 4 days" |
| 5 | Quote sent, quiet for 2+ days | "Quote sent 5 days ago, no answer" |
| 6 | Scheduled, date has passed | "The visit date has passed. Is this job done?" |

## Left out on purpose

- **Tech schedules.** She said "that would be nice later". Scheduled is a stage with an optional date and tech name, nothing more.
- **Quotes and invoices.** Only whether a quote went out, and the amount.
- **Anything she has to set up.** Setup is the engineer's job.

## Phase 2, wired but not switched on

These are in the code, not on her screens. They were tested with simulated requests only.

- **Missed calls, voicemails and texts** through a Twilio number (`src/phone.js`): a voicemail is transcribed and becomes a lead. A second message from the same number is added to the open job, not a new one.
- **Any outside form** (`POST /api/intake?key=...`), for example a Google Form.

## Stack

Cloudflare Worker (`src/`), D1 database (`schema.sql`), Workers AI, Cloudflare Email Service, static front end in `public/` with no build step.

## Run it

```
npx wrangler d1 execute morning-list --local --file schema.sql
npx wrangler dev
```

Local secrets go in `.dev.vars` (`LOGIN_PASSWORD`, `SESSION_SECRET`, `INTAKE_KEY`, `DIGEST_TO`). The login email is `LOGIN_EMAIL` in `wrangler.toml`.

The morning email is hardcoded for now: `DIGEST_TO` (a secret, the address it goes to), and `DIGEST_HOUR`, `TIMEZONE` and `MAIL_FROM` in `wrangler.toml`. A timer runs every hour and sends when it is `DIGEST_HOUR` in `TIMEZONE`.

## Next

1. Switch on Twilio so missed calls, voicemails and texts add themselves.
2. Connect her own website form or Google Form.
3. A text to her phone when a request says equipment is down.
4. Her own settings for the morning email (address and hour).
5. Forgot password and a second login for her husband or the office.
