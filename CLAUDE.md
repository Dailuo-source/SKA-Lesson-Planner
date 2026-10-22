# SKA Lesson Planner — Brief

> **Claude: read this first.** Open only the files a change touches; use the code map to jump to a function.
> `index.html` (~131 KB) and `Code.gs` (~38 KB) are large: search for a function name (e.g. `grep -n "function render" index.html`) and read just that function.
> At the end of a work session, update **Status** and add one line to **Changelog** (keep about 5).

Lesson planner for **Scarborough Academy of Karate (SKA)** instructors. A class plan is built from sections (Warm-up / Physical training, Technique / Kihon, Kata / Kigu, Kumite, Final activity) filled from a shared exercise library. Slotted exercises keep their own minutes and notes; the library only changes with "Also update the library". Used on phones (Gary: Samsung Android, Chrome PWA; others may use iPhones).

## Where things live

| Piece | Location |
| --- | --- |
| Live app | https://ska-lesson-planner.pages.dev/ (Cloudflare Pages from `main`). Never put Gary's full name in a web address |
| Database | Google Sheet **SKA Lesson Planner** (garyluo.gs@gmail.com), id `1YN23i8Fq3yK5B4G4xGRPkCelMMNFhAiC8ys9z_ZeClA`. Tabs: Plans, Plan items, Exercises, Lists, Instructors, Class notes |
| Backend | Apps Script **SKA Lesson Planner** bound to the sheet; source is `Code.gs`. Web app version 6 (Execute as Gary, Anyone) |
| Signing in | Exec URL in `API_URL` (`#api=` overrides). Email + password or Google. New accounts need the **dojo code** (Script Property `DOJO_CODE`; menus **Show app link and dojo code** / **Change the dojo code…**). Google button shows only once `GOOGLE_CLIENT_ID` is set |
| Setup guide | `SETUP.md` |

## Data model (headers matched by name)

- **Plans**: Date, Time (`18:00-19:30`, 24 h text), Focus, Class type, Length (min), Sections (ordered comma list), Skipped sections, Added by, Last edited by, Updated, After-class notes (not copied), Owner, Shared with.
- **Plan items**: Plan ID, Section, Order, Exercise, Minutes, Note ("• point" lines), Quick notes (during class) ("• 7:42 p.m. · text"; not copied), Library ID, Added by, Time changed by, Updated. Items are copies, so they survive library edits/deletes.
- **Exercises**: Section, Exercise, Minutes, Instructions ("1. step" lines, shown 1. 2. 3., no "Step" word; old header Description still matches), Notes ("• point"), Owner, Shared with, Added by (shown as the editable **Created by** black tag top-right on exercises, never on the Plans overview), Last edited by, Updated.
- **Instructors** (never sent as data): Email, Title, First, Last, Show first name, Role (Admin/Instructor), Google sign-in, Password (hashed; clear it to allow a reset with the dojo code), Salt, Joined, Last signed in. Deleting a row signs them out.
- **Lists** (List / Value / Colour / In every new plan): Section, Class type, Class length (90, 105, 120), Timeslot (`Mon 18:00-19:30 Kids`; admin-only), Attendance link. Sections added in the app get a spare-palette colour.
- **Class notes**: ID, Plan ID, Plan item ID, Kind (Class / Assignment / Person / Feedback), Student, Note, Followed up, Owner, Shared with (`Only me` / `Everyone`), Added by, Created, Updated. **Private to the writer unless shared**; only the writer edits/shares/deletes. Not copied with a plan; deleting a plan deletes your notes on it.
- Students: `students_()` reads active members from the Kata Tracker (POST `{action:'plannerMembers', key}`, Script Property `KATA_KEY` via menu **Connect to the Kata Tracker…**), cached 6 h.
- Section names can't contain commas (app swaps them for " /").

## Sharing rules (Gary's)

- Plans and exercises: Only me / Everyone / chosen instructors (blank = Everyone). New ones default to Only me.
- Shared = view and copy. **Admins** (Role; if none, the first instructor) can also edit what's shared with them; only the owner changes sharing. Admins never see others' private items.
- `stateFor_` sends each instructor only what they may see (IDs, `mine`/`canEdit`/`canShare`, `people` directory; never emails). `allowOp_` drops disallowed ops (items follow their plan; notes can't move plans).

## App design rules (`index.html`, one file)

- Theme: red #C8102E, white background, black secondary; each section keeps its colour. Header/icons use the dojo logo, not a kawaii icon.
- Tabs: **Plans**, **This class**, **Library**, **Attendance** (always asks "Open attendance?" before opening Muster Hall; it can't be embedded, `X-Frame-Options: SAMEORIGIN`).
- **Plans** = week/month calendar (`calView` saved as `skal.calview`) of class times (Lists → Timeslot) matched to plans by time; other times show as "Special". Pills: Planned / Plan it / No plan. Day filter (`plansFilter` = weekday). **Class times** button opens `sheetSlots`.
- **This class** modes (history state `m`): **view** (teaching: start times, instructions, notes, quick-note box), **edit** (sticky **Save plan**), **review** (after class; Share or copy all notes). Opens in view, or review if the date is past; new/copied plans open in edit. View-only plans show a yellow note and offer only Copy to a new date.
- Class notes box in teaching/review; share switch resets to **Only me** after every note. **Last class** card (`recapHTML`) = previous plan in the same timeslot (`skal.recap` for collapsed). **Student notes** from the person icon.
- Wide (≥1000px): tabs in the red bar, 1240px Plans, 7-column week, panels slide in from the right.
- Time shows as hours and minutes ("1h 40m of 1h 45m planned"); exercise and section times stay in minutes.
- Every button scales down slightly when pressed.
- Back button: every screen/panel is a history entry; at the first screen "Press back again to exit". Every panel has a close control (iPhones).
- Sync: optimistic, batched ops, 60 s polling. Panels are never redrawn by a background sync; library search keeps focus.
- Accounts: HMAC token (`TOKEN_SECRET`, 400 days) in `skal.token`, profile in `skal.me`; `bad_token` signs out. Labels on plans are text at edit time ("Mr. Luo").

## Link to the SKA Kata Tracker

- Separate app: https://dailuo-source.github.io/SKA-Kata-Tracker/ (`KATA_SITE`); `KATA_URL` is its Apps Script. `?api=summary` gives kata with rank, Learned at and counts (no names), cached in `skal.kata`.
- In a section whose name contains "kata", **Add from library** has **Exercises** / **Dojo kata** tabs. Dojo kata grouped Solo, Multi-person, Weapon, then by belt (Learned at, else rank; "Blue/Purple" = Blue); tap adds a 10-min item.
- Review shows **Update kata progress**, opening `KATA_SITE?kata=<name>&from=planner` in a new tab.

## Changing things

- App files: edit, bump `CACHE` in `sw.js` (currently `ska-lesson-planner-v18`), commit and push to `main`.
- Code.gs: paste into Apps Script and redeploy (**Deploy → Manage deployments → pencil → New version**). Via Claude in Chrome (instance **GARYMAIN**): open script.google.com/home → SKA Lesson Planner, set `monaco.editor.getModels()[0]` to the raw GitHub Code.gs, Ctrl+S, redeploy. New columns must also be added to the live sheet.
- Commits use author `Claude <noreply@anthropic.com>`.

## Code map
API: op-batched like Pantry Pal, signed with the instructor's token.

| File | Lines | What's in it |
|---|---|---|
| `Code.gs` | 1012 | `doGet`/`doPost`/`api`; accounts (`auth_`, `me_`, `updateProfile_`, `changePassword_`, `codeOk_`, `makeToken_`, `checkToken_`, `verifyGoogle_`); instructors (`instrRows_`, `findInstr_`, `addInstr_`, `updInstr_`); sharing (`shareOf_`, `sees_`, `canEdit_`, `canShare_`, `allowOp_`, `stateFor_`); data (`readRaw_`, `applyOp_`, `applyTo_`); students (`students_`, `fetchStudents_`, `connectKataTracker`); menu (`onOpen`, `setup`, `showKey`, `setDojoCode`, `setGoogleClientId`, `signEveryoneOut`); setup (`buildTab_`, `claimOwners_`, `seedLists_`, `seedExercises_`) |
| `index.html` | 1917 | CSS (~18–282), markup (~284–297), one `<script>` (~298–1475) |

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
- Working: plans (view / edit / review), shared library, sharing with admins, timeslots and custom lengths, Kata Tracker link, class notes with Last class and student notes. Cache v18.
- Watch: Gary once saw tapping a plan open the newest one (Oct 17); not reproducible, ask for steps if it returns.

## Changelog (latest first, keep about 5 lines)
- 2026-10-22: Trimmed this brief
- 2026-10-21: Class notes, Last class card, Student notes, names from the Kata Tracker, tap feedback. sw v18
- 2026-10-20: Plans tab is a week/month calendar; day filter; Class times button; desktop layout. sw v17
- 2026-10-18: Dojo kata picker grouped by type then belt

## Working efficiently
- Find code with search first, then read only the relevant lines. Don't read index.html top to bottom.
- Make small, targeted edits. Never regenerate a whole file.
- Don't open a browser to test unless I ask. I'll test on my phone.
- No subagents unless I ask.
- One task per session. I'll /clear between tasks.
