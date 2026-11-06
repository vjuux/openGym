# Spot: the place-first fork

A personal, non-commercial fork of [openGym](https://github.com/DuarteSantos8/openGym). The app opens
on a map, knows where you are and what that place has, and offers one session. Everything openGym
already does (logging, progression, history, stats, sync) still runs underneath, one tap away.

Working name. The Android app id is `com.vjuux.spot`, so it installs next to the official app.

## How it works

| Piece | File | What it does |
|---|---|---|
| Kit vocabulary | `frontend/src/lib/kit.js` | About 35 things a place can have, in plain words, folded into the catalogue's coarser equipment values |
| Session picker | `frontend/src/lib/spot-session.js` | About 90 hand-picked exercises by movement pattern. Picks the freshest focus from the recovery model, and what you already do comes first |
| Nearby places | `frontend/src/lib/spots.js` | OpenStreetMap through Overpass, per block of about 11 km, cached for two weeks |
| Saved places | `frontend/src/lib/spot-places.js` | An existing gym-reminder place (on the phone only) linked to an equipment profile carrying `kit` (synced, no location in it) |
| Photo reader | `frontend/src/lib/gym-scan.js` | The user's own Gemini, OpenAI or Claude key, called from the phone. The answer only seeds chips you can flip |
| Screens | `frontend/src/views/Here.jsx`, `components/HereMap.jsx`, `components/HereScan.jsx` | The map, the card, and "What's here?" |

A saved place is an ordinary equipment profile, so the library, the exercise picker and the plates
all follow it without any new code.

## What was measured (November 2026)

**OpenStreetMap knows where, rarely what.** Los Angeles has 285 mapped stations and 42% carry a
`fitness_station` tag, but only about 14% name a pull-up bar, dip bars, a ladder or rings. San
Francisco and Berlin are similar. After merging stations into places, 16 of 64 had usable kit across
six cities. That is why the photo is the main way kit gets in, for parks as well as gyms.

**Overpass is slow.** The first look at a new block took 24 to 45 s, and 2 of 8 cities gave no answer
within 50 s (the limit is now 75 s). After that a block answers instantly from the cache. The screen
never waits for it: the map and the card are usable from the start.

**The photo reader** (`node scripts/spot/eval-scan.mjs`, Wikimedia Commons categories as labels).
The two models measured are about level:

| Model | Labelled kit found | Kit reported that was not there | Seconds per photo |
|---|---|---|---|
| `gemini-3.8-flash` (the built-in one) | 26 of 31 | 0 of 25 | 5 to 18 |
| `gpt-5.6-luna` | 26 of 34 | 0 of 30 | 2 to 12 |

Gemini lost 8 of 56 calls to quota or network errors, before the one retry was added, and those
photos are not counted. Most misses are label noise. Side by side on 8 gym and park photos, Gemini
named more kit on 2, `gpt-5.6-luna` on 3, and they matched on 3; whether the extra names were right
was not scored. Wide gym shots name the main kit and miss machines in the background, so several
photos beat one.
Not measured: Claude (its request shape is unit tested only), and real user gyms.

## Limits

- **Licence.** The exercise media are licensed from Gym visual, not AGPL. A non-commercial fork may
  keep the 180 px files with `NOTICE.md`; anything commercial needs its own licence. The media must
  never go to an AI model. See `NOTICE.md`.
- **OSM's public tiles and Overpass** suit one person. With more users, serve a cached extract and
  tiles from our own server.
- **20 places** on the phone, inherited from the gym reminder. The oldest falls off.
- **New strings are English only.** The rest of the app keeps its 20 languages.
- **Android only so far.** The iOS project was not built or changed on purpose.

## Build for Android

```bash
cd frontend
npm ci
VITE_MOBILE=1 npx vite build
node ../scripts/catalogue/stage-media.mjs dist
npx cap sync android
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew assembleSideloadDebug --no-daemon
```

`npm run build:mobile` also syncs iOS, which needs a working CocoaPods. The APK lands in
`android/app/build/outputs/apk/sideload/debug/`.

## The AI key

A build without a key asks for one on the phone and keeps it in the phone's secure storage. A
personal build can carry one instead, passed as a variable on the build command:

```bash
VITE_SPOT_AI_KEY="$KEY" VITE_MOBILE=1 npx vite build
```

Never put a key in a file in this repository: the fork is public. `frontend/dist` and the Android
assets are git-ignored, but the key is readable by anyone who has that APK, so don't share the APK.
An `AQ.` key goes to Vertex AI, any other Gemini key to the Generative Language API.

## Keeping workout history

History lives on your server, not in the app. Spot connects with the same pairing code as the
official app, and the two share one profile, so neither install nor uninstall touches it. Back up
the server's data folder on its own schedule.

Tested against the 1.4.3 server on 2026-11-05: the workouts stayed identical through pairing, and
Spot's first sync only added seven settings fields (`exUnit`, `progDefault`, `programme`,
`programmes`, `volumeBodyweight`, `warmupAuto`, `wrapped`) plus sync bookkeeping. How the official
app treats those fields on its next sync was not tested.
