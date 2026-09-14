# Project Context

This file is the persistent handoff context for future work on Rahe Farda. Git is the source of truth for project state; this document records architecture, decisions, constraints, and next milestones.

## Identity
- Product: راه فردا (Rahe Farda)
- Repository: Mahdi-Amouzegar/rahe_farda
- Persian RTL first, with future English/LTR readiness.
- Offline/private/no-account oriented.
- Mobile and desktop are both first-class targets.

## Current capabilities
The existing app includes task management, subtasks, plans/programs, courses, multi-session/series scheduling, meetings, reminders, locations/maps, route calculation, grouping, templates, calendar, themes, PWA/install support, trash/archive/restore/pin, and related task operations. Preserve these capabilities while improving UI and UX.

## UI/UX principles
- Modern, professional, organized, and clear.
- Avoid generic SaaS dashboard styling, excessive cards, gradients, glassmorphism, heavy shadows, decorative clutter, and unnecessary animation.
- Mobile matters as much as desktop.
- Prefer clarity over visual novelty.
- Use Persian/RTL as a first-class experience; keep future English/LTR in mind.
- Keep advanced/rare options available through Professional Mode rather than removing functionality.
- Preserve existing application logic, data, callbacks, event contracts, and storage/schema unless a change is explicitly required.

## Current architecture decisions
- Task action buttons are consolidated into an operations menu with Persian labels while preserving existing action wiring.
- Task details use separate visible sections rather than accordion-heavy architecture.
- Settings is an independent area. Professional Mode controls information density, not feature removal.
- Reminder settings are centralized in Settings.
- Language, theme, install, and general settings belong in Settings rather than the main header.
- Permission controls belong in a dedicated permissions section. Notifications are a real permission; geolocation is managed contextually by map; microphone permission status is mobile-only.
- Calendar and map are core capabilities, not decoration.

## Map architecture and latest verified state
Map structure: `body > .container > .app-shell`, with the task flow in `.right-flow-container` and `#panelMap` as a sibling grid column of the task flow.

The map visibility lifecycle was recently fixed and verified at runtime. The important constraints are:
- Do not change the existing `42vw` map sizing rule unless a future requirement explicitly demands it.
- Do not hardcode JavaScript widths for the app shell or grid.
- Preserve the transition lifecycle and rapid-toggle safety.
- When the map is hidden, the app shell can use the full available width and `#panelMap` must actually become `display:none` after the closing transition.
- The final fix used an explicit `data-map-visibility` attribute and a responsive CSS rule that enforces `display:none` for the hidden map state.

## Next planned feature: map place search
Desired flow:
1. A search input is available in the map section.
2. The user types a place name.
3. Matching places appear directly below the search input as a selectable list.
4. Selecting a result pans/moves the map to the selected location.
5. Existing task-location and route functionality remains intact.

Provider/API is not decided yet. Before implementation, evaluate free/client-side-compatible options, geocoding accuracy, API limits/rate limits, privacy implications, attribution requirements, and Persian/RTL support. Do not replace the map architecture without need.

## Next planned feature: scalable second language
The product should be ready for a professional second-language implementation, with Persian/RTL remaining first-class and English/LTR supported without duplicating pages/components. Separate UI strings from logic where practical, handle direction/alignment/layout-sensitive UI, dates, numbers, and localization correctly, and choose the i18n approach after an architecture review.

## Working method
- Git is the persistent source of truth.
- Runtime verification is required for layout and interaction changes.
- Make focused changes; avoid unrelated refactors.
- Validate tests, build, and relevant runtime behavior before milestones.
- Update this file when architecture, important constraints, or milestones materially change.
- At milestone boundaries, a fresh chat can be used to reduce context accumulation; this file plus Git history should provide the handoff context.

## Current milestone
The modern Persian planner redesign and map visibility fixes are complete. The next planned work is map place search, followed by a scalable second-language/i18n architecture review.
