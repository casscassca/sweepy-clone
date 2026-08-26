# Sweepy

Household chore app. Lives at [sweepy.jassie.us](https://sweepy.jassie.us).

## Local

```bash
npm install
npx prisma generate
npm run dev
```

Uses the same Supabase database as production. Create a login with `node scripts/set-password.js` only if you need a new person.

## Seed rooms and tasks (Pi)

The starter catalog lives in `scripts/starter-catalog.json` (rooms, chores, difficulty, how often, and a 1–3 dirtiness). It does **not** run on deploy. When you want a fresh set of defaults:

```bash
docker exec -it sweepy node scripts/seed.js
```

If the database already has rooms or history, it asks before wiping them. After that you can add, edit, or delete anything in the app.

Users are separate:

```bash
docker exec -it sweepy node scripts/set-password.js
```

## Home Assistant

One house token in the Pi `.env` (see `example.env`):

```
HA_URL=http://host.docker.internal:8123
HA_TOKEN=...
```

Notify entities (`notify.pixel` or `notify.mobile_app_pixel`) are set on each person in the app. Sweepy listens on the HA websocket for Done / Tomorrow / Yesterday — no automation required.

Rooms and catalog chores publish to that same Mosquitto. The broker is anonymous (no user) on port 1883. From the Sweepy container:

```
MQTT_URL=mqtt://host.docker.internal:1883
```

Each room becomes an HA device with a cleanliness % (the Rooms bar) and a dirt sensor per chore. Completing a chore publishes `sweepy/event/task_completed`. Put `MQTT_URL` on the Pi only so the laptop does not double-publish.
