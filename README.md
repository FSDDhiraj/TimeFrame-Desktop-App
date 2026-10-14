# TIMEFRAME

A local-first personal time-blocking and focus app built with React, JavaScript, Tailwind CSS v4, Motion, and Lucide icons. The interface uses a custom dark design system inspired by patterns explored on [21st.dev](https://21st.dev/community/components/explore/dashboard-component), adapted for a quiet productivity workspace rather than a generic admin dashboard.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To make a production build:

```bash
npm run build
npm run preview
```

## What's implemented

- Today, Plan, Focus, Insights, and Settings views.
- Add, edit, and delete time blocks; overlap detection; category and priority labels.
- Timestamp-based scheduled countdown with animated split-flap digits.
- One active session at a time; pause/resume; early interruption logging; end-of-block outcome review.
- Fullscreen Focus Mode, showing the active task and countdown. Fullscreen changes do not reset the session.
- Generated session-start/end/reminder tones using Web Audio API.
- Generated rain texture, brown noise, white noise, and ambient tones; independent volume controls.
- Local persistence through a versioned `localStorage` record, plus JSON export/import.
- Responsive layouts, keyboard focus styles, and reduced-motion CSS support.

## Data and browser notes

- This prototype stores data in the current browser profile on this device. Clearing browser storage clears the local copy; export backups periodically.
- Browser audio usually requires a user gesture. Use the Preview controls in Settings before relying on audio cues.
- Browser tabs can be suspended. The scheduled countdown reconciles against timestamps on the next update, but a browser-only app cannot reliably measure attention or distinguish every sleep/shutdown scenario.
- The focus music/ambience is generated in the browser, not streamed from a music service.
- This is a frontend prototype; it has no account, cloud sync, or cross-device data sharing.

## Design notes

- Dark charcoal surfaces, warm off-white typography, and a restrained accent color.
- Shared motion timing and restrained transitions; the flip clock is the primary expressive animation.
- Task outcomes are separate from timer completion. Active timer duration is not presented as proof of focus.
- Scheduled end times remain fixed; pausing does not push later schedule blocks.
