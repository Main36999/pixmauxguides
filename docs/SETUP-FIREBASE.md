# /palettes — wiring up real-time likes

`/palettes` works out of the box with **zero backend**: it renders from
`palettes-data.json`'s seed `likes` counts, and the heart button still
increments/decrements (held in this browser only, tagged "preview" on
the like button so it's obvious it isn't shared yet). This doc is only
needed once you want likes to be real — the same count, live, for every
visitor.

## 1. Create the Firebase project (skip if you already have one)

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** → name it (e.g. `bpozz-palettes`) → you can decline
   Google Analytics for this, it's not needed.
2. Inside the project: **Build → Realtime Database → Create Database**.
   - Pick a location close to your users.
   - Start in **locked mode** — the rules in step 3 replace the default,
     so it doesn't matter which you pick here.
3. Still in the project: the **gear icon → Project settings → General**,
   scroll to **Your apps**, click the `</>` (web) icon, register an app
   (no Firebase Hosting needed). It'll show a `firebaseConfig` object —
   copy it into `palettes.js`'s `firebaseConfig` near the top of the
   file, replacing the `YOUR_...` placeholders. `databaseURL` sometimes
   isn't in that snippet — if so, copy it from the Realtime Database
   page itself (it's shown right above the data tree, looks like
   `https://<project>-default-rtdb.<region>.firebasedatabase.app`).

## 2. Set the security rules

**Build → Realtime Database → Rules**, replace with:

```json
{
  "rules": {
    "likes": {
      "$paletteId": {
        ".read": true,
        ".write": true,
        ".validate": "newData.isNumber() && newData.val() >= 0"
      }
    }
  }
}
```

This is intentionally open-write, matching Color Hunt's own no-account
likes — anyone can increment/decrement a count, nothing else in the
database is exposed. `palettes.js` only ever sends atomic
increment/decrement transactions (never an arbitrary overwrite), so the
worst a bad actor can do is push a count up or down, not corrupt data.
If that trade-off doesn't sit right at your traffic level, the usual
next step is a Cloud Function that owns the writes and rate-limits by
IP — outside the scope of this simple clone, but flagging it in case
this page gets popular.

## 3. Confirm it's working

- Reload `/palettes` — the "preview" tag next to the like count should
  disappear.
- Like a palette, then open the page in a private/incognito window:
  the count you just added should already be there.
- In the Firebase console's Realtime Database data view, you should see
  a `likes` node with one entry per palette id (`p001`, `p002`, …),
  each holding a plain number.

## Notes

- The `likes` numbers in `palettes-data.json` are only ever used to
  **seed** a palette's node the first time it's read — after that,
  Realtime Database is the source of truth and the JSON's number is
  ignored for that id, even if you edit the JSON later. To reset a
  palette's count, delete its node in the Firebase console and it'll
  reseed from the JSON on the next page load.
- Nothing in this project depends on Firebase Auth — likes are
  anonymous by design, same as Color Hunt.
