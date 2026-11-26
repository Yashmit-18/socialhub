# Admin console (operator guide)

The admin console is the control room for the person who runs this SocialHub. It shows who has
an account, which workspaces exist and whether the system is healthy, and it has one action:
**suspending and reactivating accounts**.

> **Status (2026-11-26).** The API (`/api/v1/admin`) and the command line are implemented and
> tested against a throwaway test database and a simulated Meta. They have not yet been used on
> the real database. The web pages at `/admin` are part of the same change. Nothing here is
> deployed until you deploy it.

"Platform admin" (access to this console) has nothing to do with the **Admin** role inside a
workspace. A workspace owner or admin does not get into the console, and a platform admin gets
no extra rights inside workspaces: to work in a workspace they need to be a member like anyone
else.

---

## 1. Becoming a platform admin

Access is given and removed **only with a command**, never from a web page. That way no request
from the internet can ever create a platform admin.

**Before you start:** the person must already have a SocialHub account (they register on the
website like everybody else). Use the email address they signed up with.

### 1.1 On your PC, against the same database

If your PC's `apps/api/.env` points at the same database as the live site (`MONGODB_URI`), run
from the repository folder:

```
npm run admin:grant -w @socialhub/api -- you@example.com
```

It prints the account that was changed, for example
`Platform admin access given to Ada Lovelace <ada@example.com> (id 665f…).` The person then
reloads SocialHub and sees **Admin console** in the sidebar. Upper case and spaces around the
address do not matter.

To point the command at another database for one run without editing `.env`, set the address
first in the same PowerShell window (the address contains a password: copy it from your host's
environment settings and do not paste it anywhere else):

```
$env:MONGODB_URI = '<the database address of the live site>'
npm run admin:grant -w @socialhub/api -- you@example.com
Remove-Item Env:MONGODB_URI
```

### 1.2 On the server

If your host gives you a command shell for the API service, the environment is already set
there. Run:

```
node apps/api/scripts/platform-admin.js grant you@example.com
```

### 1.3 Checking and removing access

| Command                                                     | What it does                                           |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `npm run admin:list -w @socialhub/api`                      | Lists every platform admin (name, email, id)           |
| `npm run admin:revoke -w @socialhub/api -- you@example.com` | Removes access; says how many platform admins are left |

On the server the same commands are `node apps/api/scripts/platform-admin.js list` and
`… revoke you@example.com`.

- A change applies on the person's **next request**; there is nothing to restart.
- Removing the last platform admin is allowed: you can always give access again with the
  command.
- A suspended account cannot be made a platform admin; reactivate it first.
- Every grant and removal is written to the audit log as done by "Command line".

### 1.4 If something goes wrong

| Message                                                         | Meaning                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `No SocialHub account uses … The person has to register first.` | No account with that address in **this** database. Check the spelling, or that the command used the live site's database |
| `… is already a platform admin. Nothing was changed.`           | Nothing to do                                                                                                            |
| `The account of … is suspended. Reactivate it first.`           | Reactivate the account in the console, then run the command again                                                        |
| The usage text, and nothing else                                | The command or the email address was missing or misspelled                                                               |
| "Admin console" does not appear                                 | Reload the page. Check `npm run admin:list`. Make sure the website and the API both run the new version (section 5)      |

---

## 2. What each page shows

The console shows **account details, names, counts and states**. It never shows the content of a
workspace. Anything the system cannot find out is shown as **Unknown**, never as 0 or "OK".

| Page                 | Shows                                                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**         | How many accounts (active, suspended, new in 7 and 30 days), workspaces (and how many publish for real), connected Facebook Pages and Instagram accounts, posts in progress; a 14-day chart (UTC days) of sign-ups, new workspaces, real, simulated and failed posts; a list of things needing attention |
| **Users**            | Every account: name, email, status (active or suspended), when it signed up and last signed in, how many workspaces it belongs to. Search by name, email or id; filter by status; newest or oldest first                                                                                                 |
| **User detail**      | The account, when it was last active and last changed its password, its workspaces with its role in each (owned ones first), and what a suspension would affect (section 3.1). For a suspended account: when, by whom and why                                                                            |
| **Workspaces**       | Every workspace: name, address, owner (with their status), number of members, number of connected Pages and Instagram accounts, whether it publishes for real. Search by name, address or id; filter by publishing mode                                                                                  |
| **Workspace detail** | Name, address, time zone, publishing mode and when it last changed, when something last happened there; its members with their roles; counts of pending invitations, logins by status, accounts, drafts, media files and their size, posts by status, Facebook Groups, open sharing tasks                |
| **System**           | Database (and whether it supports transactions); for publishing and analytics: the mode, the queue and its counts, whether a worker is running; posts waiting, being sent, late or interrupted, the next one due and the last one finished; storage; whether email is set up                             |
| **Audit log**        | Every suspension, reactivation, grant and removal of admin access: who, when, about whom, with the reason or note. Newest first; filter by kind or by person                                                                                                                                             |

What the console **deliberately never shows**, on any page:

- drafts, captions, hashtags, media files or their names, notes, labels, the Facebook Group
  directory, post text or the error text of failed posts;
- names, pictures or follower counts of connected Facebook Pages and Instagram accounts (only
  how many there are), or the names of Facebook and Instagram logins;
- the email addresses of pending invitations (only how many there are);
- IP addresses and browsers (they are stored with sessions and with audit entries, for security
  investigations, and never sent to any screen);
- passwords, password reset links, sign-in sessions or any Facebook or Instagram token.

A note on the System page: the publishing mode, analytics mode and storage shown there are the
settings of the API server that answered. A separate worker process has its own settings, which
the API cannot read. Whether a worker is running is read from the queue (Redis), so it is also
right when the worker runs in another process. Right after a quiet period the queue can show
"connecting" for a moment; that is normal.

---

## 3. Suspending and reactivating an account

Use it for an account that breaks the Terms of Service or puts other people at risk. Every user
publishes through the same Meta app, so one abusive account can endanger everyone's access.
The Terms already say: "We may suspend or close accounts that break these terms or put other
people, their data or SocialHub at risk."

### 3.1 Before you suspend

Open the person's page and read the impact:

- **live sessions** that will end at once;
- **workspaces** they belong to, and those they **own**. A workspace whose owner is suspended
  keeps working for its admins, but nobody can transfer its ownership or delete it until the
  owner is reactivated. Workspaces they own **with no other admin** are flagged: nobody there
  can manage members or connections in the meantime;
- **posts waiting to go out** that rely on them, how many of those would be **real** posts, and
  how many are **being sent right now** (those cannot be stopped).

### 3.2 Suspending

You write a reason (at least 10 characters, so it is clear later) and confirm with **your own
password**. At once:

- the account is suspended, with when, by whom and why recorded on it and in the audit log;
- **every session ends**: the person is signed out everywhere on their next click;
- an unused **password reset link is cancelled**, and no new one is sent while suspended.

When the person tries to sign in with the right password, they read: "This account has been
suspended. If you think this is a mistake, write to the address on our Terms of Service page."
Anyone who types a wrong password gets the usual "Email or password is incorrect", so the
sign-in form does not tell strangers that an account is suspended. (When email delivery is set
up, the "forgot password" form answers a little faster for a suspended account, because no
email is sent; this is a small hint, of the same kind as the sign-up form saying an address is
already taken.) The person does not receive an email, and **the
reason is never shown to them or to their team**.

You cannot suspend your own account, or another platform admin (remove their admin access with
`admin:revoke` first). If two platform admins suspend the same person at the same moment, one
succeeds and the other is told the account is already suspended.

After too many failed attempts (by default 30 within 15 minutes, the same limit as for signing
in), the console makes you wait a few minutes. Only your own failed attempts count, and they are
counted together with every other action you confirm with your password (changing it,
transferring or deleting a workspace, switching real publishing on), so a stolen sign-in cannot
be used to guess your password on another page.

### 3.3 Scheduled posts: the timing rules

1. A waiting post is refused **when its time comes**, if its author is suspended at that moment.
   Suspending does not cancel anything by itself.
2. Reactivating before a post's time lets that post go out as scheduled.
3. A post refused during the suspension **stays failed**. A teammate who may publish can retry
   it; the retry then relies on that teammate.
4. A post another member rescheduled relies on that member and is not affected.
5. A post that is already being sent when the suspension lands cannot be stopped (the impact
   preview shows how many).
6. Editing or deleting already published posts needs a session, so it stops at once.

The team sees a refused post as failed with: "The account of the person who scheduled this post
is suspended, so it was not sent." Nothing is sent to Facebook or Instagram for it. This applies
to simulated and real posts alike.

### 3.4 Reactivating

Confirm with your password; you may add a short note. The person can sign in again with their
password. Reactivation does **not** bring back their old sessions (they sign in again), does not
restore a reset link and does **not** resend posts that were refused in the meantime.

---

## 4. Privacy

- The audit log is its own record, separate from workspaces: deleting a workspace does not
  remove it. Entries are kept until someone removes them from the database by hand.
- The privacy policy and terms (`apps/web/src/pages/legal/legalContent.js`) describe what the
  console shows and that suspensions are recorded with who, when and why. If the console changes
  what it shows, update those pages and their "Last updated" date.
- Search terms typed in the console (often email addresses) are removed from the server's
  access logs.

---

## 5. Deployment notes

- **Indexes.** Before the first use, build the new indexes on the live database:
  `npm run db:indexes -w @socialhub/api` (against that database). A host that runs
  `scripts/sync-indexes.js` before each deploy does this by itself. This change only adds
  indexes and drops none. Everything works without them, only slower.
- **Website and API together.** The console pages come with the website (Vercel) and the data
  with the API (Render). Deploy both; one without the other shows no console.
- **The publish worker first.** Every process that sends posts (the API itself when its worker
  runs inline, or a separate worker) must run this version **before anyone is suspended**.
  Otherwise the console says "suspended" while an old worker still sends that person's scheduled
  posts.
- **No new settings.** There are no new environment variables, and no cookie, CORS or
  deployment-file changes. The command line needs the same settings as the API
  (`MONGODB_URI`, `JWT_ACCESS_SECRET`, `TOKEN_ENCRYPTION_KEY`).

The API contract (every endpoint, field and error) is listed in the
[README's API reference](../README.md#api-reference-v1) under "Operator console".
