# Fix: "cd could not be found" Error in Railway

## Problem
Railway is trying to execute `cd` as a command, which fails because `cd` is a shell builtin, not an executable file.

## Root Cause
Railway might have a **Start Command** configured in the dashboard that contains `cd backend && npm start`. This overrides the Dockerfile CMD.

## Solution: Remove Start Command in Railway Dashboard

### Step-by-Step Fix:

1. **Go to Railway Dashboard**
   - Navigate to your project
   - Click on your service

2. **Open Settings**
   - Click "Settings" tab
   - Scroll to "Service Settings"

3. **Check "Start Command"**
   - Look for a field called "Start Command" or "Command"
   - If it contains `cd backend && npm start` or similar, **DELETE IT**
   - Leave it **EMPTY**

4. **Verify Builder**
   - Make sure "Builder" is set to **"Dockerfile"** (not "Nixpacks")
   - The Dockerfile already has the correct CMD: `["node", "dist/index.js"]`

5. **Save and Redeploy**
   - Click "Save" or "Update"
   - Railway will automatically redeploy

## Why This Works

The Dockerfile already has the correct start command:
```dockerfile
CMD ["node", "dist/index.js"]
```

This command:
- Runs from `/app` directory (set by `WORKDIR /app`)
- Doesn't need `cd` because WORKDIR already sets the directory
- Directly executes Node.js with the built application

## Alternative: If You Can't Find Start Command Setting

If Railway dashboard doesn't show a Start Command field:

1. **Check Environment Variables**
   - Sometimes start commands are set as env vars
   - Look for `START_COMMAND` or similar

2. **Use Railway CLI** (if available):
   ```bash
   railway variables unset START_COMMAND
   ```

3. **Delete and Recreate Service**
   - As a last resort, delete the service
   - Create a new one
   - Make sure to use Dockerfile builder
   - Don't set any start command

## Verification

After fixing, check the deployment logs:
- Should see: `node dist/index.js` starting
- Should NOT see: `cd backend` or any `cd` commands
- Application should start successfully

## Current Configuration

✅ **railway.json**: Builder set to "DOCKERFILE"  
✅ **Dockerfile**: CMD is `["node", "dist/index.js"]`  
✅ **No nixpacks.toml**: Renamed to prevent conflicts  
❌ **Railway Dashboard**: May have Start Command override (needs manual removal)

The fix requires removing the Start Command override in Railway's dashboard settings.
