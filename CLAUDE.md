# SKA Lesson Planner: handoff notes

Lesson planner for the instructors at **Scarborough Academy of Karate (SKA)**. Each class plan is built from sections (Warm-up / Physical training, Technique / Kihon, Kata / Kigu, Kumite, Final activity), filled from a shared exercise library. Slotted exercises keep their own minutes and notes, so changing a time for one class doesn't touch the library unless the instructor chooses "Also update the library". Instructors use it on their own phones (Gary: Samsung Android, Chrome PWA; others may use iPhones).

## Where things live

| Piece | Location |
| --- | --- |
| Live app | https://ska-lesson-planner.pages.dev/ (Cloudflare Pages from `main` of `Dailuo-source/SKA-Lesson-Planner`). Never put Gary's full name in a web address |
| Database | Google Sheet **SKA Lesson Planner** in garyluo.gs@gmail.com's Drive, id `1YN23i8Fq3yK5B4G4xGRPkCelMMNFhAiC8ys9z_ZeClA`. Tabs: Plans, Plan items, Exercises, Lists |
| Backend | Apps Script project **SKA Lesson Planner** bound to the sheet; source is `Code.gs` here. Web app deployment version 1 is live (Execute as Gary, access Anyone) |
| Connecting a phone | Sheet menu **SKA Lesson Planner → Show app key and phone link** gives `https://ska-lesson-planner.pages.dev/#api=<exec>&key=<key>`; the app stores both in localStorage (`skal.api`, `skal.key`). `APP_SITE` in Code.gs builds that link |
| Setup guide | `SETUP.md` |

## Data model

- **Plans**: Date, Focus, Class type (Regular / Kids / Advanced), Length (min), Sections (in order, comma list), Skipped sections, Added by, Last edited by, Updated.
- **Plan items**: Plan ID, Section, Order, Exercise, Minutes, Note, Library ID, Added by, Time changed by, Updated. Items are copies of library exercises, so they survive library edits/deletes.
- **Exercises** (the library): Section, Exercise, Minutes, Description, Added by, Last edited by, Updated. Seeded with Kata Teiiru and Demonstrations (Kata / Kigu, 10 min), the only exercises Gary has named so far.
- **Lists** (List / Value / Colour / In every new plan): Section (5 defaults with colours, In every new plan = Yes), Class type, Class length (minutes: 90, 105, 120), Attendance link (`https://my.musterhall.app/today`). Extra sections added in the app are saved here without a colour; the app picks a colour from a spare palette.
- Section names can't contain commas (they're stored as a comma list); the app swaps commas for " /".

## App structure (`index.html`, one file)

- Tabs: **Plans** (new plan, copy a plan, filter by class type, coming up / past), **This class** (the open plan: class type and length chips, time card in h m, sections with −/+ per exercise, Skip/Restore, Add from library, Add a section), **Library** (search, section filter, + adds to the open class, tap to edit), **Attendance** (always asks "Open attendance?" before opening Muster Hall in the browser; Gary asked for this to avoid mistouches).
- Muster Hall can't be embedded: it sends `X-Frame-Options: SAMEORIGIN`. Gary has permission to use it but doesn't own it.
- Instructor profile is per phone (`skal.profile`): title Mr./Ms., first, last, show first name. Labels are stored as text at edit time ("Mr. Luo"), so renames apply going forward. First run asks for the profile before anything else; tapping the initials opens it.
- Back button: every screen and panel is a history entry; back closes panels first, then goes back a screen; at the first screen it shows "Press back again to exit". iPhones have no back button, so every panel has a close/back control.
- Sync: same pattern as Pantry Pal / Climb Buddy (optimistic, batched ops, 60 s polling). Panels are never redrawn by a background sync; the library search keeps focus.
- Theme (Gary's choice): red #C8102E base, white background, black secondary; each section keeps its own colour. Header and icons use the dojo logo (grey background turned white), not a kawaii icon.
- Planned time shows as hours and minutes ("1h 40m of 1h 45m planned"); exercise and section times stay in minutes.

## Changing things

- Browser: Gary has several Chrome instances connected. The one signed in to garyluo.gs@gmail.com, GitHub (Dailuo-source) and Cloudflare is named **GARYMAIN**; select it before doing setup work.

- App files: edit, bump `CACHE` in `sw.js` (currently `ska-lesson-planner-v1`), commit and push to `main`. Cloudflare deploys in about a minute.
- Code.gs: paste into Apps Script and redeploy (**Deploy → Manage deployments → pencil → New version**; URL stays the same). Through Claude in Chrome: open the sheet → Extensions → Apps Script, set `monaco.editor.getModels()[0]` to the raw GitHub Code.gs, Ctrl+S, redeploy. A new sheet column also needs adding to the live sheet (the header is matched by name).
- Commits use author `Claude <noreply@anthropic.com>`; GitHub rejects Gary's private email.
- Testing: a Node mock of SpreadsheetApp plus Playwright (route `script.google.com` to `api()`) covers the main flows end to end.
