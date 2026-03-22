# User Setup Guide

## How to Create Username and Password

There are several ways to create a user account for the application:

## Method 1: Using the Setup Script (Recommended)

### For Local Development:

1. **Navigate to backend directory:**

   ```bash
   cd backend
   ```

2. **Install dependencies** (if not already done):

   ```bash
   npm install
   ```

3. **Run the setup script** (choose one):
   - **Without building:** `npm run setup-user:dev` (uses tsx)
   - **After building:** `npm run build && npm run setup-user`

4. **Follow the prompts:**
   - Enter your desired username
   - Enter your password (minimum 6 characters)
   - Confirm your password

5. **The user will be created** and saved under **`/app/data/users.json`** by default (intended for containers with `WORKDIR /app`). For local development, set **`DATA_DIR`** in `backend/.env` to your project’s `data` folder (e.g. absolute path to `price-scraper/data`) so the file matches where `npm run dev` reads users.

### For Production (Railway/Render):

**Option A: Non-interactive (recommended for Railway CLI)**

Set environment variables in your Railway/Render dashboard, then run the script:

1. Add variables: `SETUP_USERNAME` and `SETUP_PASSWORD`
2. Open the service shell/terminal
3. Run:
   ```bash
   cd backend
   npm run setup-user
   ```
4. The script uses the env vars and creates the user without prompts

**Option B: Interactive (if your shell supports stdin)**

1. Go to your Railway/Render project dashboard
2. Open the service shell/terminal
3. Run:
   ```bash
   cd backend
   npm run setup-user
   ```
4. Follow the prompts (username, password, confirm)

## Method 2: Using the Registration API Endpoint

You can also create a user via the API (if registration endpoint is enabled):

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your-username",
    "password": "your-password"
  }'
```

**For production**, replace `http://localhost:3001` with your backend URL:

```bash
curl -X POST https://price-scraper-backend-production-7ba3.up.railway.app/api/auth/login
 \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your-username",
    "password": "your-password"
  }'
```

## Method 3: Manual User Creation (Advanced)

If you need to create a user manually:

1. **Generate password hash** using Node.js:

   ```bash
   node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('your-password', 10).then(hash => console.log(hash))"
   ```

2. **Create `data/users.json`** file:
   ```json
   [
     {
       "id": "generate-uuid-here",
       "username": "your-username",
       "passwordHash": "bcrypt-hash-from-step-1",
       "createdAt": "2024-01-01T00:00:00Z"
     }
   ]
   ```

## Password Requirements

- Minimum 6 characters
- Can contain letters, numbers, and special characters
- Passwords are hashed using bcrypt (never stored in plain text)

## Login After Setup

Once you've created a user:

1. **Start the application** (if not already running)
2. **Navigate to the login page** (`/login`)
3. **Enter your username and password**
4. **You'll be redirected** to the main application

## Multiple Users

You can create multiple users by running `npm run setup-user` multiple times. Each user is appended to **`users.json`** in the configured data directory (`/app/data` by default for the setup script, or `DATA_DIR` / the backend’s default `data/` when unset for other entrypoints).

## Troubleshooting

**"User already exists" error:**

- The username is already taken
- Choose a different username

**"Password must be at least 6 characters":**

- Your password is too short
- Use at least 6 characters

**Can't find `users.json` / login doesn’t see the user:**

- The setup script creates **`/app/data/users.json`** unless `DATA_DIR` is set; the API uses `DATA_DIR` if set, otherwise the repo’s `data/` folder. Use the **same** `DATA_DIR` for both so setup and the server read one file.
- The directory is created automatically on first write.

**Forgot password:**

- Currently, there's no password reset feature
- You can create a new user with a different username
- Or manually edit `data/users.json` to change the password hash (requires generating a new hash)
