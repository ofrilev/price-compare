# Railway Deployment Fix - "cd could not be found" Error

## Problem
Railway is trying to execute `cd` as a command, which fails because `cd` is a shell builtin, not an executable.

## Solution Applied

1. **Renamed `nixpacks.toml`** to `nixpacks.toml.backup`
   - Railway was detecting this file and trying to use Nixpacks builder
   - The Nixpacks config had `cd` commands which caused the error
   - Now Railway will use the Dockerfile instead

2. **Verified Dockerfile Configuration**
   - The Dockerfile uses `WORKDIR` instead of `cd` commands (correct Docker practice)
   - The CMD is: `["node", "dist/index.js"]` (no cd needed)
   - All paths are relative to WORKDIR `/app`

## Current Setup

- **Builder**: Dockerfile (specified in `railway.json`)
- **Dockerfile**: Located at root level, correctly configured
- **Start Command**: Handled by Dockerfile CMD (no manual start command needed)

## Next Steps

1. **Commit and push** the changes (nixpacks.toml renamed)
2. **Redeploy** in Railway
3. Railway should now use the Dockerfile and build successfully

## If Issue Persists

If Railway still tries to use `cd` commands:

1. **Check Railway Dashboard Settings**:
   - Go to your service → Settings → Service Settings
   - Verify "Builder" is set to "Dockerfile" (not "Nixpacks")
   - Remove any "Start Command" if it has `cd` in it

2. **Alternative: Use Nixpacks Properly**:
   - If you want to use Nixpacks instead:
   - Rename `nixpacks.toml.backup` back to `nixpacks.toml`
   - Update Railway builder to "Nixpacks"
   - The nixpacks.toml now uses `sh -c` to properly execute cd commands

## Verification

After deployment, check Railway logs to confirm:
- Dockerfile is being used
- Build completes successfully
- Application starts with `node dist/index.js`
