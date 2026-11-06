# 🔒 Private Web Chat

A WhatsApp-style private 2-person chat with real-time messaging, image sharing, and message editing — powered by **Supabase** and deployed on **Vercel**.

## Features

- 💬 Real-time messaging (Supabase Realtime)
- 🖼️ Image send with captions + full-screen viewer + download
- ✏️ Edit messages & captions
- ✓✓ Seen receipts (blue ticks)
- ⌨️ Typing indicator
- 🟢 Online/offline status
- 📅 Date separators
- 🔔 Notification sound
- 🌙 WhatsApp dark theme
- 💾 All chats persist in Supabase

## Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free project
2. Go to **SQL Editor** → **New Query**
3. Paste the contents of `supabase-setup.sql` and click **Run**
4. Copy your **Project URL** and **anon key** from **Settings → API**

### 2. Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) and import the repo
3. Add environment variables:
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_ANON_KEY` = your Supabase anon/public key
4. Deploy!

### 3. Local Development

```bash
cp .env.example .env.local
# Fill in your Supabase credentials in .env.local
npx vercel dev
```

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS
- **Realtime**: Supabase Realtime (Broadcast + Presence)
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage (images)
- **Hosting**: Vercel (static + serverless)

