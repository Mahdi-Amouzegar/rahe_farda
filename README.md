# Rahe Farda

<p align="center">
  <a href="./README.fa.md"><strong>راهنمای فارسی</strong></a> | <strong>English README</strong>
</p>

**A Persian-first personal planner built around the Jalali calendar, offline use, and flexible planning.**

[![Live Demo](https://img.shields.io/badge/demo-live-success)](https://mahdi-amouzegar.github.io/rahe_farda/)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/license-Proprietary-red)](#license)

---

## 1. What is Rahe Farda?

Rahe Farda is a **Persian-first, RTL-native personal planner** designed around the **Jalali (Solar Hijri) calendar**.

It is designed to help you turn intentions into organized plans: manage everyday tasks, break larger activities into steps, schedule recurring activities, attach places and notes, and keep working even when the internet is unavailable.

Rahe Farda is **not a Gregorian planner with a Persian skin**. Dates, numbers, text input, calendar flows, and the overall interface are designed with Persian users in mind, while English is supported as a second language.

### Three activity types

| Type | Description |
|---|---|
| **Task** | A single activity, optionally with a date, time, or location. |
| **Plan** | A multi-step activity made up of smaller tasks. |
| **Series** | A recurring activity that can repeat on a schedule. |

---

## 2. Highlights

- 📅 **Jalali-first planning** — built around the Persian calendar.
- 📴 **Offline-capable** — core planning features remain usable without an active connection.
- 💾 **Local-first data** — your everyday planning data is kept on your device by default.
- 🌐 **Bilingual** — Persian (RTL) and English (LTR).
- 📱 **Installable** — works as an installable web app.
- 🗺️ **Location-aware** — save places, find locations, calculate routes, and use location-based features.
- 🎤 **Voice input** — Persian and English speech input where supported.
- 🔄 **Optional multi-device sync** — continue using your data across devices when sync is enabled.
- 👥 **Shared spaces** — groups, group tasks, conversations, invitations, and task sharing.
- 🔎 **Search** — find users and public groups from within the app.
- 🌓 **Light, dark, and automatic themes**.
- ♿ **Keyboard-friendly and responsive UI** for desktop and mobile.

---

## 3. Key Features

### Tasks

- Create, edit, complete, and delete tasks
- Jalali date and time selection
- Priorities, descriptions, phone numbers, addresses, and websites
- Photo attachments
- Natural date input such as «فردا ساعت ۵» and «۳ روز دیگر»
- Trash and recovery workflow

### Plans & Series

- Multi-step plans with sub-tasks
- Progress tracking
- Recurring activities
- Flexible recurrence patterns
- Reusable templates for common workflows

### Calendar & Time

- Jalali calendar
- Day-focused views and filtering
- Upcoming-event overview
- Morning digest
- Reminders with configurable lead time

### Maps & Locations

- Location search
- Saved places with custom names
- Route calculation for common travel modes
- Live location features
- Weather information for relevant upcoming activities

### Groups & Communication

- Groups with members and roles
- Invitations and shareable invitation links
- Group tasks
- Group conversations and shared activity timeline
- Direct connections and messaging
- Blocking and connection management
- Task sharing
- Notifications
- User and group avatars
- Search across users and public groups

### Backup & Data Portability

- Backup and restore
- Sent-items archive in the current backup workflow
- Local use without requiring an account for core planning

### Interface

- Persian RTL and English LTR
- Light, dark, and automatic themes
- Simple and Pro modes
- Responsive mobile and desktop layouts
- Keyboard-friendly interactions
- Installable web-app experience

---

## 4. Current Status

### ✅ Available

- Core offline-first personal planner
- Jalali calendar and Persian-native date handling
- Tasks, Plans, Series, and sub-tasks
- Maps, locations, routes, and weather
- Reminders and morning digest
- Voice input
- Photo attachments
- Installable web app
- Optional account-based multi-device sync
- Groups, invitations, group tasks, and group conversations
- Direct connections, messaging, blocks, and task sharing
- Search for users and public groups
- User and group avatars
- Welcome wizard
- Backup and restore
- Persian and English interfaces

### ⏳ Current work

- Account lifecycle improvements
- Further service protection and operational hardening
- Final security and release review

### 🗓️ Deferred

- Additional sign-in providers
- Email/password authentication

---

## 5. Product Principles

### Local first

Rahe Farda is designed so that everyday planning does not depend on a permanent internet connection.

### Persian by design

Persian is treated as a first-class language and interaction model rather than simply translated text. RTL layout, Jalali dates, Persian numbers, and Persian date expressions are considered throughout the interface.

### Sync is optional

Cloud synchronization is an optional part of the experience. The core planner can be used locally without creating an account.

### Simple on the surface

The goal is to keep the everyday planning experience understandable while still supporting more advanced workflows when they are needed.

---

## 6. Getting Started

### As a user

**[→ Open the Live Demo](https://mahdi-amouzegar.github.io/rahe_farda/)**

You can use the application directly in a modern browser or install it as a web app when your browser supports installation.

### As a developer

Clone the repository and install its dependencies:

    git clone https://github.com/Mahdi-Amouzegar/rahe_farda.git
    cd rahe_farda
    npm install

Start the development server:

    npm run dev

Build the project:

    npm run build

Run the test suite:

    npm test

---

## 7. Project Direction

The project has moved beyond the basic task-list stage and now covers personal planning, recurring activities, offline use, optional synchronization, and shared/group workflows.

Current development is focused primarily on **hardening, account lifecycle, reliability, privacy, and release readiness** rather than continuously adding new feature areas.

---

## 8. Privacy

Rahe Farda is designed with local use in mind.

- Core planning features can be used without an account.
- Planning data is kept locally by default.
- Optional synchronization requires an account.
- Location, weather, speech, and similar external features may send the minimum information required for the requested operation to their respective services.
- The application includes an in-app privacy page with additional details.

---

## 9. License

© 1405 / 2026 Mahdi Amouzegar. All rights reserved.

Rahe Farda is **source-available software, not open-source software**.

You may:

- View the source code on GitHub.
- Clone the repository for personal use.
- Report bugs and suggest features through GitHub Issues.

You may not:

- Redistribute, sublicense, or sell the software.
- Publish modified or derivative versions.
- Reuse the code in other projects without written permission.
- Use the name, logo, or branding without written permission.

Pull requests are not accepted at this time.

---

## Acknowledgments

Rahe Farda uses and builds upon a number of open-source projects and public services, including:

- Leaflet
- OpenStreetMap
- Nominatim
- OSRM
- Open-Meteo
- Vazirmatn
- Vite

**Made with ❤ by Mahdi Amouzegar**

**Rahe Farda — Your tasks, your time, your path.**
