# SKA Lesson Planner — Brief

> **Claude: read this first.** Open only the files a change touches; use the code map to jump to a function.
> `web/index.html` (~131 KB) and `Code.gs` (~38 KB) are large: search for a function name (e.g. `grep -n "function render" web/index.html`) and read just that function.
> At the end of a work session, update **Status** and add one line to **Changelog** (keep about 5). Keep **For Gary** current too: tick off (delete) what's done, add each step Gary must do himself (deploy, sheet menus, settings, checks). App Atlas reads Status, For Gary and Changelog to show where each app is.

Lesson planner for **Scarborough Academy of Karate (SKA)** instructors. A class plan is built from sections (Warm-up / Physical training, Technique / Kihon, Kata / Kigu, Kumite, Final activity) filled from a shared exercise library. Slotted exercises keep their own minutes and notes; the library only changes with "Also update the library". Used on phones (Gary: Samsung Android, Chrome PWA; others may use iPhones).

## Where things live

| Piece | Location |
| --- | --- |
| Live app | https://ska-lesson-planner.pages.dev/ (Cloudflare Pages from `main`, build output directory `web`, so only `web/` is published). Never put Gary's full name in a web address |
| Database | Google Sheet **SKA Lesson Planner** (garyluo.gs@gmail.com), id `1YN23i8Fq3yK5B4G4xGRPkCelMMNFhAiC8ys9z_ZeClA`. Tabs: Plans, Plan items, Exercises, Lists, Instructors, Class notes, Class roster, Class groups |
| Backend | Apps Script **SKA Lesson Planner** bound to the sheet; source is `Code.gs`. Web app version 15 (Execute as Gary, Anyone) |
| Signing in | Exec URL in `API_URL` (`#api=` overrides). Email + password or Google. New accounts need the **dojo code** (Script Property `DOJO_CODE`; menus **Show app link and dojo code** / **Change the dojo code…**). Google button shows only once `GOOGLE_CLIENT_ID` is set |
| Setup guide | `SETUP.md` |

## Data model (headers matched by name)

- **Plans**: Date, Time (`18:00-19:30`, 24 h text), Focus, Class type, Length (min), Sections (ordered comma list), Skipped sections, Added by, Last edited by, Updated, After-class notes (not copied), Owner, Shared with, Sections split by belt group (no longer used since Nov 23), Away tonight, Drop-ins tonight (not copied).
- **Plan items**: Plan ID, Section, Order, Exercise, Minutes, Note ("• point" lines), Quick notes (during class) ("• 7:42 p.m. · text"; not copied), Library ID, Added by, Time changed by, Updated, Belt group (the exercise's group: any name, blank = Everyone; copied), Skipped in class (Yes/blank; not copied). Items are copies, so they survive library edits/deletes.
- **Exercises**: Section, Exercise, Minutes, Instructions ("1. step" lines, shown 1. 2. 3., no "Step" word; old header Description still matches), Notes ("• point"), Owner, Shared with, Added by (shown as the editable **Created by** black tag top-right on exercises, never on the Plans overview), Last edited by, Updated.
- **Instructors** (never sent as data): Email, Title, First, Last, Show first name, Role (Admin/Instructor), Google sign-in, Password (hashed; clear it to allow a reset with the dojo code), Salt, Joined, Last signed in. Deleting a row signs them out.
- **Lists** (List / Value / Colour / In every new plan): Section, Class type (Regular, Junior program, Advanced), Class length (45, 75, 90, 105, 120; shown sorted), Belt group (`White–Yellow: White, Yellow`; none saved = SKA's usual three, `GROUP_DEFAULT`), Custom groups (class time text = that class splits by its Class groups), Timeslot (`Wed 16:15-17:00 Junior program`; text after the time must match a Class type; admin-only; holds SKA's full weekly timetable as of Nov 10), Attendance link. Sections added in the app get a spare-palette colour.
- **Class notes**: ID, Plan ID, Plan item ID, Kind (Class / Assignment / Person / Feedback), Student, Note, Followed up, Owner, Shared with (`Only me` / `Everyone`), Added by, Created, Updated, Next week (added on first use). **Private to the writer unless shared**; only the writer edits/shares/deletes. Not copied with a plan; deleting a plan deletes your notes on it.
- **Class roster** (Nov 21): ID, Timeslot ID (Lists row ID), Class time (text, for people), Student, Added by, Updated. Kept by hand because Muster Hall has no export or API; any instructor can change it (`allowOp_`).
- **Class groups** (Nov 23): ID, Timeslot ID, Class time, Group, Students (comma list; someone can be in several groups), Order, Added by, Updated. Custom groups per class time; a class uses them instead of belt groups while Lists has a **Custom groups** row whose value is the class time (`slotText`). Any instructor can change them.
- Newer columns (`NEW_COLS`: notes next; plans split/away/dropins; items lane/skip) are added to older sheets on first use (`ensureCols_`); the Class roster tab is made on the first add.
- Students: `students_()` reads active members from the Kata Tracker (POST `{action:'plannerMembers', key}`, Script Property `KATA_KEY` via menu **Connect to the Kata Tracker…**), cached 6 h. New students are added in the Kata Tracker: Student notes → **Add a new student** opens `KATA_SITE?add=member&from=planner` (straight to its Add a member form); coming back, the next sync sends `refreshStudents:true`, which clears the cache.
- **Feedback** (testers, Nov 10; not in SCHEMA, so never sent as data): ID, Sent, From, Email, Kind (Something broke / Idea / Confusing / Other), Screen, Message, Device, App version, Status (New / Seen / Done, Gary sets it), Reply (they see it). Tab is made on the first send (`addFeedback_`); `myFeedback_` returns only the sender's own rows on `{feedback}` or `{myFeedback:true}`.
- Section names can't contain commas (app swaps them for " /").
- **Instructors → Notification settings** (JSON): `{slots:[Timeslot values], before, noplan, asg}`, each `{on, rel: min before}` or `{on, day: -1|0, at:'HH:MM'}`; `asg` may be `{same:true}` (with the Before class reminder). **Push** tab (never sent to the app): one row per phone (email, push address, keys, device).

## Sharing rules (Gary's)

- Plans and exercises: Only me / Everyone / chosen instructors (blank = Everyone). New ones default to Only me.
- Shared = view and copy. **Admins** (Role; if none, the first instructor) can also edit what's shared with them; only the owner changes sharing. Admins never see others' private items.
- `stateFor_` sends each instructor only what they may see (IDs, `mine`/`canEdit`/`canShare`, `people` directory; never emails). `allowOp_` drops disallowed ops (items follow their plan; notes can't move plans).

## App design rules (`index.html`, one file)

- Theme: red #C8102E, white background, black secondary; each section keeps its colour. Header/icons use the dojo logo, not a kawaii icon.
- **Compact** (Gary, Oct 30, like Pantry Pal): tight vertical spacing, 1px borders, 44px main buttons, 36–40px chips/icon buttons. The overrides live in one "Compact layout" CSS block just above the big-screens media query; keep new styles in that spirit.
- Desktop stretches to the full window width (no max-width on `main`; Gary's standing rule for all apps).
- Tabs: **Plans**, **This class**, **Library**, **Attendance** (always asks "Open attendance?" before opening Muster Hall; it can't be embedded, `X-Frame-Options: SAMEORIGIN`).
- **Plans** = week/month calendar (`calView` saved as `skal.calview`) of class times (Lists → Timeslot) matched to plans by time; other times show as "Special". Pills: Planned / Plan it / No plan. Day filter (`plansFilter` = weekday). **Class times** button opens `sheetSlots`.
- **This class** modes (history state `m`): **view** (teaching: start times, instructions, notes, quick-note box), **edit** (sticky **Save plan**), **review** (after class; Share or copy all notes). Opens in view, or review if the date is past; new/copied plans open in edit. View-only plans show a yellow note and offer only Copy to a new date.
- **Teaching mode** (Gary, Nov 5): `teachBar` (Now: exercise, N of M done, on time / behind / ahead when it's that day), a tick box on the right of each exercise (`tCheck`, kept on the phone in `skal.tdone`), first unticked = **You are here**, ticked cards shrink to one line; section headers fold (`tFold`, `skal.tfold`; a section folds itself when its last exercise is ticked); each exercise shows its clock time (`hm12`, "≈ 8:15 p.m.") when the plan has a start time; sticky **End class & review** opens review.
- **Nov 21 (Gary)**: teaching mode has a **skip** button per exercise (`tSkip`, items `skip`; one-line Skipped row with Undo; times shift), exercises fold to one line (`tCard`; phone-only `skal.texp`/`skal.tcol`; the one you're on opens by itself), **+ Note** reveals the quick-note box and focuses it (`qnOpen`, `QOPEN`; the ONE box allowed to open the keyboard by itself), **Collapse all / Expand all** (`foldAll`/`openAll`, per mode: tfold/texp, rfold/rexp, efold/eexp), sticky bar **Class note** + **End class & review**. Class notes card in teaching has no Consolidate or Next week (review keeps both). Review: After class, Class notes and **Skipped tonight** cards fold; Skipped tonight has **Add to next class** (`skipToNext`, next plan in the same timeslot). Every section, belt group and exercise folds in all three modes. Folds slide (Nov 23): `FOLD_ACTS` toggles are snapshotted before the re-render (`foldSnap`), then the box (`foldBox`: .lane/.gbox/.ecomp/.rrow/.card/section/article) grows open, or the old box is shown sliding shut and swapped back (`foldPlay`, `slideOpen`/`slideShut`); lanes are wrapped in `.lane` for this. New fold toggles need a `data-act` in `FOLD_ACTS`.
- **Class note panel** (`sheetNote`, `NB`, `addClassNote`): opened by Class note / Add. Kinds: Told the class, Assignment, **Student feedback** (was One student; kind stays `Person`), Exercise feedback. Pick several students; they sit in foldable belt-group boxes with **All**; pool = Here tonight (else all active members); Not here tonight folded; find box for anyone else. One note per student. The box and picks clear before saving (the old bug: `store.add` re-rendered and the text came back).
- **Groups per exercise** (Gary, Nov 23; replaced the section-level Belt groups switch): each exercise is for Everyone or one group (items `lane`; picked with the group chip under its name, `laneOpen` → `sheetLane`: this class's groups, the other kind, names already used, or a new name). Back-to-back grouped exercises form a block that runs at the same time (`secBlocks`, `blockMin`; section time = sum of blocks), shown as "At the same time" in edit and as lanes in teaching/review (`laneKey`). Belt groups (`beltGroups`) are still edited in `sheetGroups`.
- **Edit plan rows** (Nov 23): drag handle (`.dragh`; pointer events, `DRAG`, auto-scroll, order saved on release), name (tap opens notes + Edit for this class), group chip, minutes, delete with an Are you sure panel (`askDelItem` → `delItem`, Undo toast).
- **Custom groups** (Nov 23): `groupsFor(p)` = the plan's class custom groups (`customGroups`, `customOn`) or the belt groups; `inGroup`, `bucket` (a name can land in several boxes; the rest go to "Not in a group" / "No belt yet"). Students → Class roster → Groups card: Belt groups / Custom groups switch (`cgMode`) and **Edit** (`sheetCGroups`, `cgSave`). Lanes, switch labels (`groupsWord`), note picker and Here tonight all follow it.
- **Keyboard** (Nov 23): viewport `interactive-widget=resizes-content`; a script before `MP.init` lifts `#sheetWrap` by the keyboard height on iPhones (visualViewport) and scrolls a focused `.sheet input[type=search]` to the top (`.sheet.finding` adds room below). The Students find box sits at the top of the panel and keeps focus after each add (`csRefind`).
- **Students panel** (`sheetClassStu`, `classStudents`): **Here tonight** (everyone on the roster is here until tapped away: plans `away`; drop-ins: `dropins`) and **Class roster** (add/remove per timeslot; `slotOfPlan` = same weekday + start time). Strip on teaching/review (`studStrip`) and **Class mix** card in edit (`mixCard`).
- **Next week notes**: class notes have a **Next week** toggle (`noteNext`, `next` column; not for assignments, which already carry); they show first in the next class's **Last class** card under For this week. **Consolidate** (`sheetConsol`) lists every note from the class; quick notes and after-class notes marked Next week become private Exercise feedback notes (`qnNext`/`rvNext`).
- Class notes box in teaching/review; share switch resets to **Only me** after every note. **Last class** card (`recapHTML`) = previous plan in the same timeslot (`skal.recap` for collapsed). **Student notes** from the person icon.
- Wide (≥1000px): tabs in the red bar, full-width pages, 7-column week, panels slide in from the right.
- Time shows as hours and minutes ("1h 40m of 1h 45m planned"); exercise and section times stay in minutes.
- Every button scales down slightly when pressed, and every tap shows a red-ringed flash and waits 0.1 s before acting (Gary, Oct 30; capture click listener after `needGuard`, `.tapflash`).
- Back button: every screen/panel is a history entry; at the first screen "Press back again to exit". Every panel has a close control (iPhones).
- Sync: optimistic, batched ops, 60 s polling. Panels are never redrawn by a background sync; library search keeps focus.
- Accounts: HMAC token (`TOKEN_SECRET`, 400 days) in `skal.token`, profile in `skal.me`; `bad_token` signs out. Labels on plans are text at edit time ("Mr. Luo").

## Feedback (testers, Nov 10)

- **Feedback** chip in the red bar (every screen, signed in) and **Send feedback** row in the profile open `sheetFeedback`: kind chips (DOM toggle, no re-render so typed text stays), textarea (never auto-focused), auto-filled screen (`screenName`), device, `APP_VER` (bump with `CACHE`), Send, then the sender's earlier feedback with Status pill and Gary's Reply. `FEEDBACK_TO` = "Mr. Luo".

## Notifications (Gary, Oct 30)

- Profile → **Notifications** (`sheetNotify`): turn on for this device (`pushOn`/`pushOff`, Send a test), **Classes I teach** (Timeslot chips), and three reminders with presets + **Custom**: Before class (30 min / 1 h / 2 h / custom h m), No plan yet (day before 7 p.m. / morning of / 3 h before / custom day + time; only when no plan exists at that date and start time), Assignments to follow up (with the class reminder / morning of / custom; open assignments from earlier plans in the same timeslot that are yours or shared). Settings save as you change them (`req.notify`). Picking **Custom** sets `custom:true` on that reminder (kept by `cleanWhen_`) so its time boxes stay open even when the time matches a preset.
- Sending: Apps Script can't sign/encrypt Web Push, so `push/` is a Cloudflare Worker (`ska-lesson-planner-push`, cron every 5 min). It POSTs `{cron: CRON_KEY}`; `cron_` → `due_` returns every message due since `CRON_LAST` (max 2 h back), one per phone; the Worker sends them (VAPID ES256 + aes128gcm) and reports 404/410 addresses back as `{cron, gone}`. `POST <worker>/run` sends straight away (used after Send a test).
- Setup (once): on Gary's PC, `cd push && node setup.mjs` (deploys the Worker, stores `VAPID_PRIVATE`/`VAPID_PUBLIC`/`CRON_KEY` as Worker secrets, prints a setup code) → sheet menu **Set up notifications…** → paste. Script Properties `VAPID_PUBLIC`, `PUSH_URL` (sent to the app by `auth:'config'`), `CRON_KEY`, `CRON_LAST`. Re-running setup makes new keys and clears the Push tab (phones turn on again).
- Status-bar icon: `web/badge-96.png` (white torii on transparent; Android shows badges as a one-colour silhouette, so an opaque image is a white square).
- Tapping a notification opens `./#plan=<id>` (service worker `notificationclick` → focuses the app and posts `{open}`, or opens it); `openFromLink`. iPhones need the app on the Home Screen.
- Tests (not in repo): `push.test.mjs` decrypts a payload as a phone would and verifies the JWT; `notify.test.js` runs Code.gs on the mock for timing, privacy and sign-ups.

## Plan switcher

- The plan title in all three modes is a dropdown (`planHead`, `planListHTML`): Coming up / Past classes, class-type filter chips, ‹ › step through plans in date/time order (`planOrder`, `switchPlan`, replaces the history entry). The date line above the title is bold and black.

## Link to the SKA Kata Tracker

- Separate app: https://dailuo-source.github.io/SKA-Kata-Tracker/ (`KATA_SITE`); `KATA_URL` is its Apps Script. `?api=summary` gives kata with rank, Learned at and counts (no names), cached in `skal.kata`.
- In a section whose name contains "kata", **Add from library** has **Exercises** / **Dojo kata** tabs. Dojo kata grouped Solo, Multi-person, Weapon, then by belt (Learned at, else rank; "Blue/Purple" = Blue); tap adds a 10-min item.
- Review shows **Update kata progress**, opening `KATA_SITE?kata=<name>&from=planner` in a new tab.

## Changing things

- App files: edit, bump `CACHE` in `web/sw.js` (currently `ska-lesson-planner-v29`; also bump `APP_VER` in index.html), commit and push to `main`.
- Code.gs: paste into Apps Script and redeploy (**Deploy → Manage deployments → pencil → New version**). Via Claude in Chrome (instance **GARYMAIN**): open script.google.com/home → SKA Lesson Planner, set `monaco.editor.getModels()[0]` to the raw GitHub Code.gs, Ctrl+S, redeploy. New columns must also be added to the live sheet.
- Commits use author `Claude <noreply@anthropic.com>`.

## Deploying Code.gs

- Web app deployment ID: `AKfycbz7Id0hiGIUFrRDDywyo8o3Ytobt2dnCbeo6BhRW-J7bCeBOZ4rSlz1wmpt3g8Tpe5f`. Always update this deployment so the /exec URL never changes.
- From this folder, `.clasp.json` points clasp at the script project (rootDir is the repo root, where `Code.gs` is):
  ```
  clasp push
  clasp deploy -i AKfycbz7Id0hiGIUFrRDDywyo8o3Ytobt2dnCbeo6BhRW-J7bCeBOZ4rSlz1wmpt3g8Tpe5f -d "what changed"
  ```
- Never run `clasp deploy` without `-i`: that creates a new deployment with a new /exec URL. `clasp deployments` lists them.

## Code map
API: op-batched like Pantry Pal, signed with the instructor's token.

| File | Lines | What's in it |
|---|---|---|
| `Code.gs` | 1232 | `doGet`/`doPost`/`api`; accounts (`auth_`, `me_`, `updateProfile_`, `changePassword_`, `codeOk_`, `makeToken_`, `checkToken_`, `verifyGoogle_`); instructors (`instrRows_`, `findInstr_`, `addInstr_`, `updInstr_`); sharing (`shareOf_`, `sees_`, `canEdit_`, `canShare_`, `allowOp_`, `stateFor_`); data (`readRaw_`, `applyOp_`, `applyTo_`); students (`students_`, `fetchStudents_`, `connectKataTracker`); menu (`onOpen`, `setup`, `showKey`, `setDojoCode`, `setGoogleClientId`, `signEveryoneOut`); setup (`buildTab_`, `claimOwners_`, `seedLists_`, `seedExercises_`) |
| `web/index.html` | 2256 | CSS (~18–282), markup (~284–297), one `<script>` (~298–1475) |

Inside the `index.html` script, search for:
- Sync: `readLinkParams`, `callApi`, `enqueue`, `flush`, `normalize`, `boot`
- Sections and lists: `listRows`, `secColour`, `allSections`, `classTypes`, `classLengths`, `planSections`, `addSection`
- Sharing: `shareLabel`, `shareTag`, `shareField`, `readShare`
- Time and timeslots: `parseTime`, `fmtTime`, `slots`, `slotChips`, `timeField`, `saveSlotIf`, `setFormLength`, `sheetSlots`
- Point notes: `pointsEditor`, `renumber`, `addPointAfter`, `notesText`
- Screens: `go`, `render`, `renderView`, `onData`
- Plans: `viewPlans`, `planCard`, `dayEntries`, `planSlot`, `classDays`, `sheetNewPlan`, `sheetCopyPick`, `sheetCopy`, `planFormChange`
- This class: `viewPlan` (edit), `viewTeach` (view), `viewReview` (review), `viewOnlyNote`, `itemHTML`, `addItem`
- Library: `viewLibrary`, `exListHTML`, `sheetEx`, `sheetExView`, `sheetItem`, `sheetPick`
- Kata Tracker link: `loadKata`, `kataPickHTML`, `kataUpdateHTML`, `usage`
- Class notes: `NOTE_KINDS`, `notesOf`, `sameSlot`, `earlierSlot`, `NB`, `noteBoxHTML`, `nbNamesHTML`, `noteLi`, `recapHTML`, `studentListHTML`, `sheetStudents`, `sheetStudent`
- Profile and sign-in: `viewProfile`, `viewAuth`, `loadGis`, `mountGis`, `fetchConfig`, `authCall`, `signOut`
- Panels: `openSheet`, `swapSheet`, `closeSheet`, `renderSheet`, `toast`

## Status
- Nov 21: skip, collapsing, class note panel (multi-student), belt groups, students (roster + here tonight). Cache v29 (Nov 23: sliding folds). Code.gs deployed as web app v15 (Nov 23, Class groups; v14 was a redeploy of v13's code).
- Working: plans (view / edit / review), teaching mode, Next week notes, shared library, sharing with admins, timeslots and custom lengths, Kata Tracker link, class notes with Last class and student notes, compact layout, Add a new student. Tester Feedback. Cache v24. Web app v12 (Nov 12: Code.gs `custom` flag; v11 Feedback tab; v10 Next week column; v9 Oct 30 notifications + refreshStudents).
- Testers (Nov 10): Gary is inviting a few SKA instructors (role Instructor) with the app link + dojo code; sign-in is email + password (no `GOOGLE_CLIENT_ID` set).
- Notifications: live (Nov 10). Worker `ska-lesson-planner-push` at ska-lesson-planner-push.garyluo-gs.workers.dev; sheet setup done; `/run` answers ok. Each phone turns them on in Profile → Notifications.
- Watch: Gary once saw tapping a plan open the newest one (Oct 17); not reproducible, ask for steps if it returns.

## For Gary

Steps only Gary can do (App Atlas shows these as his to-dos). One line each; delete a line once it's done.

- [ ] Fill each class's roster once (a class → Students → Class roster)
- [ ] Turn notifications on on your phone (Profile → Notifications) and pick your classes
- [ ] Check the Feedback tab now and then (set Status to Seen / Done, type a Reply if useful)
- [ ] Send the tester invite (app link + dojo code)

## Motion

- **Motion pack** (`window.MP`, same copy in every app; Climb Buddy is the model): the `<script>` block before `</body>` in `web/index.html`, set up by the `MP.init({...})` line under it. Panels rise from the bottom and slip back down, toasts rise and slip away (setting `.hidden = true` plays the slip-away first, then hides; the app still reads `.hidden` as true at once), a new screen's pieces rise in one after another, and a new row on the same screen rises in. Unhurried (Gary wants animations easy to see); off under reduced motion. If a close function empties or removes the panel, do it after `MP.ms` (or use `MP.out(el, done)`), or the panel slides away empty.

## Changelog (latest first, keep about 5 lines)
- 2026-11-23: Folding slides open and shut everywhere (sections, groups/lanes, exercises, cards, panel boxes, Collapse/Expand all): `foldSnap`/`foldPlay` around fold taps. sw v29
- 2026-11-23: Deployed Code.gs (Class groups tab for custom groups) as web app v15
- 2026-11-23: Edit plan: drag exercises to reorder, delete button (asks first), groups set per exercise (any group, new names allowed) instead of a section switch; back-to-back grouped exercises run at the same time. sw v28
- 2026-11-23: Custom groups per class (hand-picked, someone can be in several; switch Belt/Custom per class), keyboard no longer hides the member list (find box at the top, stays focused after adding). Code.gs: Class groups tab. sw v27
- 2026-11-21: Deployed Code.gs (Class roster tab, belt groups, skips, here tonight) as web app v13
- 2026-11-21: Skip exercises in class, fold everything (exercises, belt groups, sections, cards; Collapse/Expand all), + Note opens on tap, Class note panel with Student feedback for several students (one note each; box clears after +), Consolidate/Next week only in review, Skipped tonight → Add to next class, belt groups per section, Students panel (class roster + here tonight). Code.gs: Class roster tab, plan/item columns. sw v26
- 2026-11-12: Deployed Code.gs (`custom` flag keeps Custom class length open) as web app v12
- 2026-11-12: Motion pack: panels and toasts rise and slip away, new screens rise in, new rows rise in. sw v25, APP_VER v25
- 2026-11-11: Notifications: Custom timing now opens its boxes (was stuck when the time matched a preset); torii status-bar icon instead of a white square. sw v24
- 2026-11-10: Tester Feedback (chip + profile row → Feedback tab, status and reply shown back); full SKA timetable in Lists, Kids type renamed Junior program, lengths 45/75; profile name hint uses your own name. sw v23
- 2026-11-10: Merged teaching mode into main; Code.gs deployed as web app v10 for testers
- 2026-11-05: Teaching mode: tick off exercises ("You are here", teaching bar with pace), tap a section to fold it, clock time per exercise, End class & review; class notes get Next week (carried to next class's Last class card) and Consolidate. Code.gs: Class notes `Next week` column. sw v22
- 2026-10-30: Notifications (settings, push Worker, setup), plan switcher dropdown with ‹ ›, bold class date. sw v21
