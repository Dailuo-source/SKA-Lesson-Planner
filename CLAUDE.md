# SKA Lesson Planner — Brief

> **Claude: read this first.** Open only the files a change touches, and use the code map below to jump to a function instead of reading whole files.
> `index.html` is about 131 KB (~34k tokens): don't read it whole; search for a function name (e.g. `grep -n "function render" index.html`) and read just that function.
> `Code.gs` is about 38 KB (~10k tokens): don't read it whole; search for a function name (e.g. `grep -n "function render" Code.gs`) and read just that function.
> At the end of a work session, update **Status** and add one line to **Changelog** (keep about 10).

Lesson planner for the instructors at **Scarborough Academy of Karate (SKA)**. Each class plan is built from sections (Warm-up / Physical training, Technique / Kihon, Kata / Kigu, Kumite, Final activity), filled from a shared exercise library. Slotted exercises keep their own minutes and notes, so changing a time for one class doesn't touch the library unless the instructor chooses "Also update the library". Instructors use it on their own phones (Gary: Samsung Android, Chrome PWA; others may use iPhones).

## Where things live

| Piece | Location |
| --- | --- |
| Live app | https://ska-lesson-planner.pages.dev/ (Cloudflare Pages from `main` of `Dailuo-source/SKA-Lesson-Planner`). Never put Gary's full name in a web address |
| Database | Google Sheet **SKA Lesson Planner** in garyluo.gs@gmail.com's Drive, id `1YN23i8Fq3yK5B4G4xGRPkCelMMNFhAiC8ys9z_ZeClA`. Tabs: Plans, Plan items, Exercises, Lists, Class notes (made on the first note) |
| Backend | Apps Script project **SKA Lesson Planner** bound to the sheet; source is `Code.gs` here. Web app deployment version 6 is live; the Exercises sheet header was renamed Description → Instructions (Execute as Gary, access Anyone) |
| Signing in | The exec URL is built into `index.html` (`API_URL`; a link with `#api=` overrides it). Instructors sign in with email + password or Google. Creating an account needs the **dojo code** (Script Property `DOJO_CODE`, menu **Show app link and dojo code** / **Change the dojo code…**). Google sign-in needs `GOOGLE_CLIENT_ID` (menu **Set Google sign-in client ID…**); the button only shows once it's set |
| Setup guide | `SETUP.md` |

## Data model

- **Plans**: Date, Time (`18:00-19:30`, 24 h, text), Focus (also the event name), Class type (Regular / Kids / Advanced), Length (min), Sections (in order, comma list), Skipped sections, Added by, Last edited by, Updated, After-class notes ("• point" lines, added in review mode; not copied with a plan; column added at the end by setup), Owner (email), Shared with.
- **Plan items**: Plan ID, Section, Order, Exercise, Minutes, Note (point form, "• point" lines), Quick notes (during class) ("• 7:42 p.m. · text" lines, added from the teaching view; not copied with a plan), Library ID, Added by, Time changed by, Updated. Items are copies of library exercises, so they survive library edits/deletes.
- **Exercises** (the library): Section, Exercise, Minutes, Instructions (numbered steps, stored as "1. step" lines; shown as 1. 2. 3. (no "Step" word, Gary's choice); older header Description still matches; lines without numbers are read as steps too), Notes (one point per line, stored as "• point" lines), Owner (email), Shared with, Added by (shown in the app as the editable **Created by** label, a black tag in the top-right corner of every exercise: library cards, plan rows, the add-from-library list; never on the Plans overview, Gary's choice), Last edited by, Updated. Seeded with Kata Teiiru and Demonstrations (Kata / Kigu, 10 min), the only exercises Gary has named so far.
- **Instructors** (never sent to the app as data): Email, Title, First name, Last name, Show first name, Role (Admin/Instructor), Google sign-in, Password (hashed; clear the cell to let someone reset with the dojo code), Salt (hidden), Joined, Last signed in. Deleting a row signs that person out everywhere.
- **Lists** (List / Value / Colour / In every new plan): Section (5 defaults with colours, In every new plan = Yes), Class type, Class length (minutes: 90, 105, 120), Timeslot (`Mon 18:00-19:30 Kids`: day, 24 h range, optional class type; added by admins from Plans → Class timeslots or "Save as a regular … timeslot"), Attendance link (`https://my.musterhall.app/today`). Extra sections added in the app are saved here without a colour; the app picks a colour from a spare palette.
- **Sharing** (Gary's rules): every plan and exercise is Only me / Everyone / chosen instructors ("Shared with" holds `Only me`, `Everyone` or a comma list of emails; blank = Everyone). New ones default to Only me. People it's shared with can view and copy; **Admins** (Role column; if nobody has a role, the first instructor to join counts) can also edit what's shared with them, but only the owner changes who can see it. Admins never see others' private items. `stateFor_` sends each instructor only what they may see, with owners/shares as instructor IDs plus `mine`/`canEdit`/`canShare` flags and a `people` directory (id, name, admin), never emails; `allowOp_` drops any op they aren't allowed to make (items follow their plan; Timeslot rows and list deletes are admin-only). Setup's `claimOwners_` gave rows from before sharing the first admin as owner and Everyone.
- **Class notes** (Gary, Oct 21): ID, Plan ID, Plan item ID (feedback only), Kind (Class = told the class / Assignment / Person = one student / Feedback = on an exercise), Student (or "Whole class"), Note, Followed up (Yes/blank, assignments), Owner (email), Shared with (`Only me` or `Everyone` = every instructor who can see the plan), Added by, Created, Updated. **Private to the writer unless they share it** (Gary's rule); only the writer can edit, share, follow up or delete. `allowOp_` refuses notes on plans you can't see and never lets a note move plans; `stateFor_` sends your own notes plus shared ones on plans you can see. Not copied with a plan; deleting a plan deletes your notes on it.
- **Students**: `students_()` gets active members (name, belt) from the Kata Tracker (`KATA_API`, POST `{action:'plannerMembers', key}`), cached 6 h in CacheService, sent as `state.students`. Needs Script Property `KATA_KEY` (menu **Connect to the Kata Tracker…**, paste the key from the tracker's menu **Show the Lesson Planner key**). Names typed by hand are kept on the note and offered again.
- Section names can't contain commas (they're stored as a comma list); the app swaps commas for " /".

## App structure (`index.html`, one file)

- **Plans tab = calendar** (Gary, Oct 20): Week view by default, Week | Month switch (`calView`, saved as `skal.calview`), ‹ › to page (`calOff`). Each day lists its class times (Lists → Timeslot) matched to that date's plans by time (`dayEntries`); plans at other times show as "Special". Cards: big start time, class type, focus, and one pill: Planned / Plan it / No plan. "Plan it" opens New plan with the date, time, length and class type filled in (`planSlot` → `sheetNewPlan(s)`). Month view: dots per class, tap a day to list it. The old list is under "All plans as a list".
- **Day filter** replaces the class-type filter: All days + each weekday that has a class time (`classDays`, `plansFilter` holds the weekday number).
- **Class times** button at the top of Plans opens the timeslot panel (`sheetSlots`), so class times are managed on their own, not only while making a plan.
- **Wide screens (≥1000px)**: tabs move into the red bar, Plans is 1240px wide with a 7-column week, panels slide in from the right (so Add from library sits beside the plan), larger teaching-view text. `body[data-tab]` / `[data-mode]` hooks for page-specific widths.

- Tabs: **Plans** (new plan, copy a plan, filter by class type, coming up / past sorted by date then time; cards show time, owner and a sharing tag; **Class timeslots** link; new/copy forms have date → that weekday's timeslot chips (pick sets length and class type), Custom start/end ("No regular classes on Fridays…" for special events), No set time, length chips + Other (h/m), and Who can see it), **This class** (the open plan, in one of three modes: **view** = teaching view with each exercise's start time (0:15), full numbered instructions, library notes, class notes and a quick-note box; **edit** = class type and length chips, time card in h m, sections with −/+ per exercise, Skip/Restore, Add from library, Add a section, sticky **Save plan**. **review** = after class: summary counts, After-class notes, every exercise's planned notes and quick notes (add more, delete, "Add to library notes" appends the note text to the exercise's library Notes), **Share or copy all notes** (Android share sheet, else clipboard, else a text box). Plans opened from the list start in view, or review if the date is past; new/copied plans start in edit; ⋯ menu → **Edit plan** / **Review class** / **Teaching view**; the teaching view ends with "Class done? Review the notes". Plan cards show the note count. View-only plans show a yellow "shared with you to view" note, no edit/quick-note/delete controls, and ⋯ offers Copy to a new date. Mode is in history state `m`), **Library** (search, section filter, + adds to the open class, tap to edit; someone else's exercise opens read-only with **Copy to edit**), **Attendance** (always asks "Open attendance?" before opening Muster Hall in the browser; Gary asked for this to avoid mistouches).
- **Class notes and Last class** (Gary, Oct 21; mock-up boards 7–9 on the planner canvas): the teaching view and the review have a **Class notes** box: kind buttons (Told the class / Assignment / One student / Exercise feedback), student chips (recent names, plus Find a student over the Kata Tracker list; "Use “typed name”"; assignments default to Whole class), exercise chips for feedback, a share switch that resets to **Only me** after every note. Each note row: tag, time, Only me/Shared, lock button to share/unshare, delete with Undo, Follow up for assignments. Teaching and edit views open with a **Last class** card (`recapHTML`): the previous plan in the **same timeslot** (same weekday and start time; no time = same weekday and class type), with told-the-class, assignments (that class's, plus older undone ones from the same slot, "from Tue, Oct 13"), individual notes per student (tap a name), exercise feedback (typed + old quick notes), after-class notes, Full review and Find a student. Collapsed state in `skal.recap`. **Student notes** (person icon on the Plans tab, or from the card): search every student, then one student's open assignments and every note by class.
- Tap feedback: every button scales down slightly when pressed.
- Muster Hall can't be embedded: it sends `X-Frame-Options: SAMEORIGIN`. Gary has permission to use it but doesn't own it.
- Accounts: sign-in returns a signed token (HMAC with Script Property `TOKEN_SECRET`, 400 days) kept in `skal.token`; the profile comes back as `me` and is cached in `skal.me`. Every API call sends the token; `bad_token` signs the phone out. Menu **Sign everyone out** rotates the secret. Profile (title Mr./Ms., first, last, show first name) is edited from the initials button and saved to the Instructors tab, so it's the same on every device. Labels on plans are stored as text at edit time ("Mr. Luo"), so renames apply going forward. Google ID tokens are checked with UrlFetchApp against Google's tokeninfo endpoint (`aud` must equal the client ID).
- Back button: every screen and panel is a history entry; back closes panels first, then goes back a screen; at the first screen it shows "Press back again to exit". iPhones have no back button, so every panel has a close/back control.
- Sync: same pattern as Pantry Pal / Climb Buddy (optimistic, batched ops, 60 s polling). Panels are never redrawn by a background sync; the library search keeps focus.
- Theme (Gary's choice): red #C8102E base, white background, black secondary; each section keeps its own colour. Header and icons use the dojo logo (grey background turned white), not a kawaii icon.
- Planned time shows as hours and minutes ("1h 40m of 1h 45m planned"); exercise and section times stay in minutes.

## Link to the SKA Kata Tracker

- The Kata Tracker is its own app: https://dailuo-source.github.io/SKA-Kata-Tracker/ (repo `Dailuo-source/SKA-Kata-Tracker`, see its CLAUDE.md). `KATA_URL` in `index.html` is its Apps Script web app; `?api=summary` returns every dojo kata with its rank belt, handbook **Learned at** belt and how many active members still need it (counts only, no names). `KATA_SITE` is the app's address.
- In a section whose name contains "kata", **Add from library** has two tabs: **Exercises** and **Dojo kata**. Dojo kata are grouped like the Kata Tracker's Kata tab (Gary's choice, Oct 18): Solo, then Multi-person, then Weapon, each by belt (Learned at, else rank; "Blue/Purple" counts as Blue), in the sheet's order, with type chips (All / Solo / Multi-person / Weapon) and belt chips to narrow it; tapping one adds it as a one-off 10-min item named after the kata (tap again to remove). The summary is cached in `skal.kata` and refreshed on open and whenever the app comes back to the foreground.
- Review mode shows **Update kata progress** for every dojo kata in the plan (matched by name). It opens `KATA_SITE?kata=<name>&from=planner` in a new tab, which goes straight to that kata, asks the instructor to sign in with their Moderator or Admin access code if needed (the tracker has per-person access levels now), and lists the students who still need it; its back button closes the tab.

## Changing things

- Browser: Gary has several Chrome instances connected. The one signed in to garyluo.gs@gmail.com, GitHub (Dailuo-source) and Cloudflare is named **GARYMAIN**; select it before doing setup work.

- App files: edit, bump `CACHE` in `sw.js` (currently `ska-lesson-planner-v18`), commit and push to `main`. Cloudflare deploys in about a minute.
- Code.gs: paste into Apps Script and redeploy (**Deploy → Manage deployments → pencil → New version**; URL stays the same). Through Claude in Chrome: open the script project (script.google.com/home → SKA Lesson Planner; the sheet's Extensions → Apps Script opens outside the tab group), set `monaco.editor.getModels()[0]` to the raw GitHub Code.gs, Ctrl+S, redeploy. A new sheet column also needs adding to the live sheet (the header is matched by name).
- Commits use author `Claude <noreply@anthropic.com>`; GitHub rejects Gary's private email.
- Testing: a Node mock of SpreadsheetApp plus Playwright (route `script.google.com` to `api()`) covers the main flows end to end; a second suite covers two instructors (private/shared/admin, refused edits), timeslots and custom lengths.
- 2026-10-17: Gary reported tapping a plan opened the newest one; not reproducible (tests, and his real sheet in Chrome, open the tapped plan every time). Ask for steps if it comes back.

## Code map
API: op-batched like Pantry Pal, signed with the instructor's token instead of an app key.

| File | Lines | What's in it |
|---|---|---|
| `Code.gs` | 1012 | `doGet`/`doPost`/`api`; accounts (`auth_`, `me_`, `updateProfile_`, `changePassword_`, `codeOk_`, `makeToken_`, `checkToken_`, `verifyGoogle_`); instructors (`instrRows_`, `findInstr_`, `addInstr_`, `updInstr_`); sharing (`shareOf_`, `sees_`, `canEdit_`, `canShare_`, `allowOp_`, `stateFor_`); data (`readRaw_`, `applyOp_`, `applyTo_`); menu (`onOpen`, `setup`, `showKey`, `setDojoCode`, `setGoogleClientId`, `signEveryoneOut`); setup (`buildTab_`, `claimOwners_`, `seedLists_`, `seedExercises_`) |
| `index.html` | 1917 | CSS (~18–282), markup (~284–297), one `<script>` (~298–1475) |

Inside the `index.html` script, search for:
- Sync: `readLinkParams`, `callApi`, `enqueue`, `flush`, `normalize`, `boot`
- Sections and lists: `listRows`, `secColour`, `allSections`, `classTypes`, `classLengths`, `planSections`, `addSection`
- Sharing: `shareLabel`, `shareTag`, `shareField`, `readShare`
- Time and timeslots: `parseTime`, `fmtTime`, `slots`, `slotChips`, `timeField`, `saveSlotIf`, `setFormLength`, `sheetSlots`
- Point notes: `pointsEditor`, `renumber`, `addPointAfter`, `notesText`
- Screens: `go`, `render`, `renderView`, `onData`
- Plans: `viewPlans`, `planCard`, `sheetNewPlan`, `sheetCopyPick`, `sheetCopy`, `planFormChange`
- This class: `viewPlan` (edit), `viewTeach` (view), `viewReview` (review), `viewOnlyNote`, `itemHTML`, `addItem`
- Library: `viewLibrary`, `exListHTML`, `sheetEx`, `sheetExView`, `sheetItem`, `sheetPick`
- Kata Tracker link: `loadKata`, `kataPickHTML`, `kataUpdateHTML`, `usage`
- Class notes: `NOTE_KINDS`, `notesOf`, `sameSlot`, `earlierSlot`, `NB` (note box state), `noteBoxHTML`, `nbNamesHTML`, `noteLi`, `recapHTML`, `studentListHTML`, `sheetStudents`, `sheetStudent`; Code.gs `students_`, `fetchStudents_`, `connectKataTracker`
- Profile and sign-in: `viewProfile`, `viewAuth`, `loadGis`, `mountGis`, `fetchConfig`, `authCall`, `signOut`
- Panels: `openSheet`, `swapSheet`, `closeSheet`, `renderSheet`, `toast`

## Status
- Working: plans with view / edit / review modes, shared library, private/shared sharing with admins, class timeslots and custom lengths, Kata Tracker link, typed class notes with Last class recap and student notes. Cache v18.
- Watch: Gary once reported tapping a plan opened the newest one (Oct 17, 2026); not reproducible, so ask for steps if it comes back.

## Changelog (latest first, keep about 10 lines)
- 2026-10-21: Class notes (told the class / assignment / student / feedback), private unless shared; Last class card from the same timeslot; Student notes; names from the Kata Tracker; tap feedback. sw v18.
- 2026-10-20: Plans tab is a week/month calendar of class times and plans; day-of-week filter; Class times button; desktop layout. sw v17.
- 2026-10-18: Dojo kata picker grouped by type then belt, like the Kata Tracker (replaces the handbook filter)
- 2026-10-18: Turned the handoff notes into a brief (read-first rules, code map, status, changelog)
- 2026-10-17: Notes: Kata Tracker now uses moderator sign-in
- 2026-10-17: Notes: cache is v15
- 2026-10-17: Notes: sharing, timeslots, deployment v6; cache v15
- 2026-10-17: Merge the Kata Tracker link
- 2026-10-17: App: private or shared plans and exercises, admin edits, class timeslots, custom class length
- 2026-10-17: Backend: private/shared plans and exercises, admin role, class time
