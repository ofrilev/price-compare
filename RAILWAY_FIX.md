# Railway Deployment Fix

## Quick Fix for "npm: command not found" Error

Railway is trying to build from the root directory but can't find npm. Here's how to fix it:

### Solution: Set Root Directory in Railway

1. Go to your Railway project dashboard
2. Click on your service
3. Go to **Settings** → **Service Settings**
4. Scroll down to **Root Directory**
5. Set it to: `backend`
6. Click **Save**
7. Railway will automatically redeploy

This tells Railway to treat the `backend` folder as the root, so it will:
- Find `backend/package.json` and auto-detect Node.js
- Run `npm install` and `npm run build` from the correct directory
- Start the app with `npm start` from the backend directory

### Alternative: If Root Directory Setting Doesn't Work

If you can't find the Root Directory setting or it doesn't work:

1. **Option A**: Rename `backend/Dockerfile` to `backend/Dockerfile.backup` temporarily
   - This forces Railway to use Nixpacks instead of Docker
   - Railway will auto-detect Node.js from `backend/package.json`

2. **Option B**: Create a `package.json` in the root directory:
```json
{
  "name": "price-scraper",
  "scripts": {
    "install": "cd backend && npm install",
    "build": "cd backend && npm run build",
    "start": "cd backend && npm start"
  }
}
```
   - Railway will detect this and use it
   - But you'll need to install Node.js dependencies in root too

### Recommended Approach

**Set Root Directory to `backend`** - this is the cleanest solution and requires no code changes.

After setting the root directory, your Railway build should work correctly!
