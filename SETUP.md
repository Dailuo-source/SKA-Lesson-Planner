# SKA Lesson Planner setup

SKA Lesson Planner keeps everything in a Google Sheet. The app itself is hosted on Cloudflare Pages
(Chrome on Android won't install two apps from the same website, so each app gets its own address).

## 1. The Google Sheet (on a computer)

1. Make a new sheet at sheets.new and name it **SKA Lesson Planner**.
2. Open **Extensions → Apps Script**, delete what's in `Code.gs`, paste in this repo's `Code.gs`, and save.
3. Pick **setup** in the function list at the top and press **Run**. Allow the permissions it asks for.
   This makes the **Plans**, **Plan items**, **Exercises** and **Lists** tabs, fills Lists with the five
   sections, class types, class lengths and the attendance link, and adds Kata Teiiru and Demonstrations
   to the library.
4. Choose **Deploy → New deployment**, pick type **Web app**, set *Execute as: Me* and
   *Who has access: Anyone*, then **Deploy**. Copy the Web app URL (it ends in `/exec`).
5. Back in the sheet, reload it, then choose **SKA Lesson Planner → Set web app link…** and paste that URL.

## 2. Hosting (Cloudflare Pages)

1. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git** and pick the **SKA-Lesson-Planner** repo.
2. Name the project **ska-lesson-planner**. Leave the build settings empty and choose **Save and Deploy**.
3. The app is then at `https://ska-lesson-planner.pages.dev/`. If Cloudflare gives you a different
   address, change `APP_SITE` near the top of `Code.gs` to match and save.

## 3. Each instructor's phone

1. In the sheet, choose **SKA Lesson Planner → Show app key and phone link**.
2. Send that link to the instructor. They open it once in Chrome (Android) or Safari (iPhone). It connects
   the app to the sheet and remembers it.
3. They enter their title, first and last name. They're shown as Mr./Ms. and their last name, with an
   option to show their first name too. They can change it later by tapping their initials.
4. Install it: Android Chrome menu **⋮ → Add to Home screen → Install**. iPhone Safari **Share → Add to Home Screen**.

Anyone with the phone link can edit plans, so only share it with instructors.

## Changing things later

- **Lists tab**: add sections (with a hex colour; *In every new plan* = Yes for the ones every plan starts
  with, in order), class types, class lengths (in minutes) and the attendance link. The app picks up
  changes on its next sync.
- **Plans, Plan items and Exercises tabs**: edit or delete rows freely. Rows you type in yourself get an ID
  automatically. Plan items belong to a plan through *Plan ID*.
- **App updates**: bump `CACHE` in `sw.js` whenever the app files change, so phones load the new version.
