# Deployment Guide

This guide will help you deploy the Price Scraper app with authentication to free-tier hosting platforms.

## Architecture

- **Frontend**: Vercel (React/Vite app)
- **Backend**: Railway or Render (Express/Node.js API)
- **Storage**: File-based JSON files (persisted on hosting platform)

## Prerequisites

1. GitHub account (for connecting to hosting platforms)
2. OpenAI API key (for LLM features)
3. Git repository with your code

## Step 1: Prepare Environment Variables

### Backend Environment Variables

Create a `.env` file in the `backend` directory with:

```bash
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://your-frontend.vercel.app
JWT_SECRET=<generate-a-strong-random-secret>
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini
```

**Generate JWT Secret:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Frontend Environment Variables

Create a `.env.production` file in the `backoffice` directory:

```bash
# Must include /api path - e.g. https://your-backend.up.railway.app/api
VITE_API_URL=https://your-backend.railway.app/api
```

## Step 2: Deploy Backend (Railway)

### Option A: Railway

1. Go to [railway.app](https://railway.app) and sign up/login
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Railway will use Nixpacks (configured via `nixpacks.toml`)
5. **Important**: In Railway dashboard, set the **Root Directory** to `backend`:
   - Go to Settings → Service Settings
   - Set "Root Directory" to `backend`
   - Or configure it to use the root directory and Nixpacks will handle it
6. Configure environment variables in Railway dashboard:
   - `PORT` (auto-set by Railway)
   - `NODE_ENV=production`
   - `FRONTEND_URL` (your Vercel URL)
   - `JWT_SECRET` (generated secret)
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional)
7. Railway will build and deploy automatically
8. Copy the deployment URL (e.g., `https://your-app.railway.app`)

**Troubleshooting Railway Deployment**:

If you encounter "npm: command not found" errors:

**Solution 1** (Recommended): Set Root Directory in Railway

1. Go to your Railway project → Settings → Service Settings
2. Find "Root Directory" setting
3. Set it to `backend`
4. Redeploy

**Solution 2**: Use Nixpacks Configuration

- The `nixpacks.toml` file in the root should configure Railway to use Node.js
- Ensure it's committed to your repository
- Railway will use it automatically

**Solution 3**: Remove Dockerfile (if using Nixpacks)

- If Railway detects a Dockerfile, it may try to use Docker instead of Nixpacks
- You can temporarily rename `backend/Dockerfile` to `backend/Dockerfile.backup`
- Or configure Railway to use Nixpacks explicitly in the dashboard

### Option B: Render

1. Go to [render.com](https://render.com) and sign up/login
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: `price-scraper-backend`
   - **Environment**: `Node`
   - **Build Command**: `cd backend && npm install && npm run build`
   - **Start Command**: `cd backend && npm start`
   - **Root Directory**: Leave empty (or set to `backend` if needed)
5. Add environment variables in Render dashboard
6. Add a persistent disk:
   - Name: `price-scraper-data`
   - Mount Path: `/app/data`
   - Size: 1GB
7. Deploy and copy the URL

## Step 3: Deploy Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) and sign up/login
2. Click "Add New" → "Project"
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `backoffice`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Add environment variable:
   - `VITE_API_URL` = your backend URL **including /api** (e.g. `https://your-backend.up.railway.app/api`)
6. Deploy

## Step 4: Create Initial User

After deployment, create your first user account:

### Option A: Using Railway/Render Console

1. Open the Railway/Render console/terminal
2. Run:

```bash
cd backend
npm run setup-user
```

3. Follow the prompts to create a user

### Option B: Using Local Setup

1. Clone your repository locally
2. Create a `.env` file in `backend` with production values
3. Run:

```bash
cd backend
npm install
npm run setup-user
```

4. Commit the `data/users.json` file (or manually add it to your hosting platform)

### Option C: Using Registration Endpoint

If registration is enabled, you can use the `/api/auth/register` endpoint:

```bash
curl -X POST https://your-backend.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-secure-password"}'
```

## Step 5: Update CORS Configuration

After deploying frontend, update the backend `FRONTEND_URL` environment variable to match your Vercel URL.

## Step 6: Test Deployment

1. Visit your Vercel frontend URL
2. You should be redirected to `/login`
3. Log in with the credentials you created
4. Test the price comparison functionality

## Troubleshooting

### Backend Issues

**Playwright not working:**

- Ensure Dockerfile includes Playwright dependencies
- Check Railway/Render logs for browser installation errors
- Consider using headless mode if needed

**File storage issues:**

- Ensure persistent disk is mounted correctly (Render)
- Check file permissions
- Verify `data/` directory exists

**CORS errors:**

- Verify `FRONTEND_URL` matches your Vercel domain exactly
- Check backend logs for CORS errors
- Ensure credentials are enabled in CORS config

### Frontend Issues

**API connection errors:**

- Verify `VITE_API_URL` is set correctly
- Check browser console for network errors
- Ensure backend is running and accessible

**Authentication issues:**

- Check that JWT_SECRET is set
- Verify token is being stored in localStorage
- Check backend logs for auth errors

### General Issues

**Build failures:**

- Check build logs in hosting platform
- Ensure all dependencies are in package.json
- Verify Node.js version compatibility

**Environment variables:**

- Double-check all variables are set correctly
- Restart services after changing env vars
- Use platform-specific variable syntax if needed

## Security Notes

1. **Never commit `.env` files** - use platform environment variables
2. **Use strong JWT_SECRET** - generate a random 32+ character string
3. **Use HTTPS** - both Vercel and Railway/Render provide SSL automatically
4. **Limit CORS** - only allow your frontend domain
5. **Strong passwords** - use complex passwords for user accounts

## Cost Estimation

- **Vercel**: Free tier (unlimited for frontend)
- **Railway**: $5/month free credit (usually sufficient for small apps)
- **Render**: Free tier available (may sleep after inactivity)

## Alternative: Single Platform Deployment

If you prefer a single platform, you can deploy both frontend and backend on Render:

1. Deploy backend as Web Service (as above)
2. Deploy frontend as Static Site:
   - Build Command: `cd backoffice && npm install && npm run build`
   - Publish Directory: `backoffice/dist`
   - Add environment variable: `VITE_API_URL`

This simplifies deployment but may have different limitations.

## Updating the Application

After making changes:

1. Push to GitHub
2. Vercel will auto-deploy frontend
3. Railway/Render will auto-deploy backend
4. No manual steps needed (unless env vars changed)

## Support

For platform-specific issues:

- Railway: [docs.railway.app](https://docs.railway.app)
- Render: [render.com/docs](https://render.com/docs)
- Vercel: [vercel.com/docs](https://vercel.com/docs)
