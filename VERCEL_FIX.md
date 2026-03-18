# Vercel Deployment Fix

## Problem

Vercel is trying to run `cd backoffice && npm install` but can't find the directory, or `rootDirectory` is not a valid property in vercel.json.

## Solution Applied

1. **Moved `vercel.json` to `backoffice/` directory** - This is the correct location when using Root Directory
2. **Removed `rootDirectory` from vercel.json** - This property is set in Vercel Dashboard, not in the file
3. **Simplified build command** - Just `npm run build` (Vercel auto-runs `npm install`)

## Important: Check Vercel Dashboard Settings

Even with `vercel.json` configured correctly, **Vercel dashboard settings can override the file**. You need to:

### Step 1: Go to Vercel Dashboard

1. Open your project in Vercel
2. Go to **Settings** → **General**

### Step 2: Check Root Directory

1. Find **"Root Directory"** setting
2. Set it to: `backoffice`
3. Click **Save**

### Step 3: Check Build & Development Settings

1. Go to **Settings** → **Build & Development Settings**
2. **Remove or clear** any of these if they contain `cd backoffice`:
   - **Build Command** - should be empty or just `npm run build`
   - **Install Command** - should be empty (Vercel auto-detects `npm install`)
   - **Output Directory** - should be `dist` (relative to backoffice)

### Step 4: Verify Framework

- **Framework Preset**: Should be `Vite` or auto-detected
- Vercel should detect Vite from `backoffice/package.json`

## Current vercel.json Configuration

**Location**: `backoffice/vercel.json`

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

**Important**: `rootDirectory` is NOT in vercel.json - it's configured in Vercel Dashboard only!

## After Making Changes

1. **Commit and push** the updated `vercel.json`
2. **Update dashboard settings** as described above
3. **Redeploy** - Vercel will use the correct configuration

## Why This Works

- **Root Directory** set in Vercel Dashboard tells Vercel to treat `backoffice/` as the project root
- **vercel.json** is now in `backoffice/` directory (correct location)
- All commands run from `backoffice/` automatically (no `cd` needed)
- Vercel auto-detects and runs `npm install` before build
- Build command runs `npm run build` from `backoffice/`
- Output goes to `backoffice/dist`

## Troubleshooting

If it still fails:

1. **Delete the project** in Vercel and recreate it
2. **Import from GitHub** again
3. **Set Root Directory** to `backoffice` during import
4. Vercel will use `vercel.json` automatically
