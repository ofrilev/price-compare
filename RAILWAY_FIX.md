# Railway Deployment Fix

## Fixed: "npm: command not found" Error

The issue was that Railway detected a Dockerfile but it wasn't configured correctly for Railway's build context.

### What Was Fixed

1. **Created root-level Dockerfile** - Railway builds from root, so the Dockerfile is now at the root level
2. **Updated Dockerfile context** - It now correctly copies from `backend/` directory
3. **Added .dockerignore** - Excludes unnecessary files from Docker build

### Current Setup

Railway will now:
- Detect the Dockerfile at root level
- Build correctly with Node.js 20
- Install dependencies and build TypeScript
- Start the app on port 3001

### If You Still Have Issues

**Option 1**: Use Nixpacks instead of Docker
- In Railway dashboard → Settings → Service Settings
- Set "Builder" to "Nixpacks" (instead of Docker)
- Railway will use the `nixpacks.toml` configuration

**Option 2**: Set Root Directory
- In Railway dashboard → Settings → Service Settings  
- Set "Root Directory" to `backend`
- This works if Railway uses Nixpacks auto-detection

**Option 3**: Remove Dockerfile temporarily
- Rename `Dockerfile` to `Dockerfile.backup`
- Railway will use Nixpacks automatically
- The `nixpacks.toml` will configure the build

### Recommended: Use the Root Dockerfile

The Dockerfile at the root should now work correctly with Railway. Just redeploy and it should build successfully!
