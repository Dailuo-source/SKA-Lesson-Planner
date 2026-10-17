# SKA Lesson Planner: handoff notes

Lesson planner for the instructors at **Scarborough Academy of Karate (SKA)**. Each class plan is built from sections (Warm-up / Physical training, Technique / Kihon, Kata / Kigu, Kumite, Final activity), filled from a shared exercise library. Slotted exercises keep their own minutes and notes, so changing a time for one class doesn't touch the library unless the instructor chooses "Also update the library". Instructors use it on their own phones (Gary: Samsung Android, Chrome PWA; others may use iPhones).

## Where things live

| Piece | Location |
| --- | --- |
| Live app | https://ska-lesson-planner.pages.dev/ (Cloudflare Pages from `main` of `Dailuo-source/SKA-Lesson-Planner`). Never put Gary's full name in a web address |
| Database | Google Sheet **SKA Lesson Planner** in garyluo.gs@gmail.com's Drive, id `1YN23i8Fq3yK5B4G4xGRPkCelMMNFhAiC8ys9z_ZeClA`. Tabs: Plans, Plan items, Exercises, Lists |
| Backend | Apps Script project **SKA Lesson Planner** bound to the sheet; source is `Code.gs` here. Web app deployment version 5 is live; the Exercises sheet header was renamed Description → Instructions (Execute as Gary, access Anyone) |
| Signing in | The exec URL is built into `index.html` (`API_URL`; a link with `#api=` overrides it). Instructors sign in with email + password or Google. Creating an account needs the **dojo code** (Script Property `DOJO_CODE`, menu **Show app link and dojo code** / **Change the dojo code…**). Google sign-in needs `GOOGLE_CLIENT_ID` (menu **Set Google sign-in client ID…**); the button only shows once it's set |
| Setup guide | `SETUP.md` |

## Data model

- **Plans**: Date, Focus, Class type (Regular / Kids / Advanced), Length (min), Sections (in order, comma list), Skipped sections, Added by, Last edited by, Updated, After-class notes ("• point" lines, added in review mode; not copied with a plan; column added at the end by setup).
- **Plan items**: Plan ID, Section, Order, Exercise, Minutes, Note (point form, "• point" lines), Quick notes (during class) ("• 7:42 p.m. · text" lines, added from the teaching view; not copied with a plan), Library ID, Added by, Time changed by, Updated. Items are copies of library exercises, so they survive library edits/deletes.
- **Exercises** (the library): Section, Exercise, Minutes, Instructions (numbered steps, stored as "1. step" lines; shown as 1. 2. 3. (no "Step" word, Gary's choice); older header Description still matches; lines without numbers are read as steps too), Notes (one point per line, stored as "• point" lines), Added by (shown in the app as the editable **Created by** label, a black tag in the top-right corner of every exercise: library cards, plan rows, the add-from-library list; never on the Plans overview, Gary's choice), Last edited by, Updated. Seeded with Kata Teiiru and Demonstrations (Kata / Kigu, 10 min), the only exercises Gary has named so far.
- **Instructors** (never sent to the app as data): Email, Title, First name, Last name, Show first name, Google sign-in, Password (hashed; clear the cell to let someone reset with the dojo code), Salt (hidden), Joined, Last signed in. Deleting a row signs that person out everywhere.
- **Lists** (List / Value / Colour / In every new plan): Section (5 defaults with colours, In every new plan = Yes), Class type, Class length (minutes: 90, 105, 120), Attendance link (`https://my.musterhall.app/today`). Extra sections added in the app are saved here without a colour; the app picks a colour from a spare palette.
- Section names can't contain commas (they're stored as a comma list); the app swaps commas for " /".

## App structure (`index.html`, one file)

- Tabs: **Plans** (new plan, copy a plan, filter by class type, coming up / past), **This class** (the open plan, in one of three modes: **view** = teaching view with each exercise's start time (0:15), full numbered instructions, library notes, class notes and a quick-note box; **edit** = class type and length chips, time card in h m, sections with −/+ per exercise, Skip/Restore, Add from library, Add a section, sticky **Save plan**. **review** = after class: summary counts, After-class notes, every exercise's planned notes and quick notes (add more, delete, "Add to library notes" appends the note text to the exercise's library Notes), **Share or copy all notes** (Android share sheet, else clipboard, else a text box). Plans opened from the list start in view, or review if the date is past; new/copied plans start in edit; ⋯ menu → **Edit plan** / **Review class** / **Teaching view**; the teaching view ends with "Class done? Review the notes". Plan cards show the note count. Mode is in history state `m`), **Library** (search, section filter, + adds to the open class, tap to edit), **Attendance** (always asks "Open attendance?" before opening Muster Hall in the browser; Gary asked for this to avoid mistouches).
- Muster Hall can't be embedded: it sends `X-Frame-Options: SAMEORIGIN`. Gary has permission to use it but doesn't own it.
- Accounts: sign-in returns a signed token (HMAC with Script Property `TOKEN_SECRET`, 400 days) kept in `skal.token`; the profile comes back as `me` and is cached in `skal.me`. Every API call sends the token; `bad_token` signs the phone out. Menu **Sign everyone out** rotates the secret. Profile (title Mr./Ms., first, last, show first name) is edited from the initials button and saved to the Instructors tab, so it's the same on every device. Labels on plans are stored as text at edit time ("Mr. Luo"), so renames apply going forward. Google ID tokens are checked with UrlFetchApp against Google's tokeninfo endpoint (`aud` must equal the client ID).
- Back button: every screen and panel is a history entry; back closes panels first, then goes back a screen; at the first screen it shows "Press back again to exit". iPhones have no back button, so every panel has a close/back control.
- Sync: same pattern as Pantry Pal / Climb Buddy (optimistic, batched ops, 60 s polling). Panels are never redrawn by a background sync; the library search keeps focus.
- Theme (Gary's choice): red #C8102E base, white background, black secondary; each section keeps its own colour. Header and icons use the dojo logo (grey background turned white), not a kawaii icon.
- Planned time shows as hours and minutes ("1h 40m of 1h 45m planned"); exercise and section times stay in minutes.

## Link to the SKA Kata Tracker

- The Kata Tracker is its own app: https://dailuo-source.github.io/SKA-Kata-Tracker/ (repo `Dailuo-source/SKA-Kata-Tracker`, see its CLAUDE.md). `KATA_URL` in `index.html` is its Apps Script web app; `?api=summary` returns every dojo kata with its rank belt, handbook **Learned at** belt and how many active members still need it (counts only, no names). `KATA_SITE` is the app's address.
- In a section whose name contains "kata", **Add from library** has two tabs: **Exercises** and **Dojo kata**. Dojo kata default to the handbook ones (those with a Learned at belt), sorted by how many students still need them; tapping one adds it as a one-off 10-min item named after the kata (tap again to remove). The summary is cached in `skal.kata` and refreshed on open and whenever the app comes back to the foreground.
- Review mode shows **Update kata progress** for every dojo kata in the plan (matched by name). It opens `KATA_SITE?kata=<name>&from=planner` in a new tab, which goes straight to that kata, asks for the instructor password if needed, and lists the students who still need it; its back button closes the tab.

## Changing things

- Browser: Gary has several Chrome instances connected. The one signed in to garyluo.gs@gmail.com, GitHub (Dailuo-source) and Cloudflare is named **GARYMAIN**; select it before doing setup work.

- App files: edit, bump `CACHE` in `sw.js` (currently `ska-lesson-planner-v14`), commit and push to `main`. Cloudflare deploys in about a minute.
- Code.gs: paste into Apps Script and redeploy (**Deploy → Manage deployments → pencil → New version**; URL stays the same). Through Claude in Chrome: open the script project (script.google.com/home → SKA Lesson Planner; the sheet's Extensions → Apps Script opens outside the tab group), set `monaco.editor.getModels()[0]` to the raw GitHub Code.gs, Ctrl+S, redeploy. A new sheet column also needs adding to the live sheet (the header is matched by name).
- Commits use author `Claude <noreply@anthropic.com>`; GitHub rejects Gary's private email.
- Testing: a Node mock of SpreadsheetApp plus Playwright (route `script.google.com` to `api()`) covers the main flows end to end.
