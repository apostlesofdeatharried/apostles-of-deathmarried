# Apostles of deathmarried

> **The Sacred Digital Archive, Interactive Music Games, and Community Sanctuary for Artist deathmarried.**

---

## 🌹 Architecture & Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Motion, Lucide Icons.
- **Audio Engine**: Custom HTML5 Audio continuous playback with playlist queuing, shuffle, repeat, and seek controls.
- **Backend**: Node.js & Express running on port 3000 with integrated Vite middlewares (`server.ts`).
- **Persistent Relational Database**: SQLite via `better-sqlite3` on disk (`data/apostles.db`) with full relational constraints and foreign keys.
- **Production Cloud Migration**: Complete PostgreSQL / Supabase DDL migration file located at `supabase/migrations/20261109000000_init_schema.sql`.
- **Security & Auth**: Nickname + Password authentication, salted bcrypt hashing, secure HTTP-only cookies, session tokens, and strict role-based access control (`guest`, `user`, `moderator`, `admin`).

---

## 🏛 Key Sections & Features

1. **HOME**:
   - Minimalist gothic central composition.
   - Sacred velvet rose emblem (`/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg`).
   - Cinematic prologue intro animation with instant skip and `?autostart=1` query parameter support.
2. **ARCHIVE**:
   - Canon discography only: Official albums and singles.
   - Album views with full tracklists, durations, and lyrics modal.
   - One-click track and album playback.
3. **GAMES**:
   - **Guess The Track**: Listen to authentic audio snippet fragments, identify the canon track, earn XP and speed bonuses.
   - **Daily Lore Quiz**: Synchronized daily question set evaluated server-side. Tracks daily streak counters.
   - **Leaderboards**: All-time, weekly, and monthly disciples rankings with levels and XP.
4. **COMMUNITY (FORUM)**:
   - Categorized discussions (Lore & Symbols, Official Releases, Production & Gear, General Sanctuary).
   - Comments threads, replies, and gothic reactions (🌹 Rose, 💀 Skull, 🔥 Flame).
   - File attachment support for discussions.
5. **CREATIONS (GALLERY)**:
   - Community fan artwork, alternative covers, video edits, beats, remixes, and poetry.
   - Secure media upload via server `/api/upload`.
   - Likes and detailed view.
6. **PROFILES**:
   - User level, XP progress bar, unlocked achievements, published works, discussions, and follow/unfollow system.
7. **ADMIN CHAMBER**:
   - Overview metrics (disciples, albums, tracks, discussions, creations, pending reports).
   - User suspension (ban / unban) and role assignments (`user`, `moderator`, `admin`).
   - Quiz question creation and curation.
   - Addition of canon audio tracks to official albums.
8. **I18N**:
   - Full Russian (RU) and English (EN) support across all navigation and interactive components.

---

## 🔑 Default Administrator Credentials

For immediate administration testing in the dev sanctuary:
- **Nickname**: `deathmarried_admin`
- **Password**: `apostle_admin_2026`
- **Role**: `admin`

---

## 🚀 Running & Verification

```bash
# Run logic unit tests
npm test

# Run development server (full stack on port 3000)
npm run dev

# Build for production
npm run build
```
