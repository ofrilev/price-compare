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

3. **Run the setup script:**
   ```bash
   npm run setup-user
   ```

4. **Follow the prompts:**
   - Enter your desired username
   - Enter your password (minimum 6 characters)
   - Confirm your password

5. **The user will be created** and saved to `data/users.json`

### For Production (Railway/Render):

**Option A: Using Railway Console**
1. Go to your Railway project dashboard
2. Click on your service
3. Click "View Logs" or "Open Terminal"
4. Run:
   ```bash
   cd backend
   npm run setup-user
   ```
5. Follow the prompts

**Option B: Using Render Shell**
1. Go to your Render dashboard
2. Click on your service
3. Click "Shell" tab
4. Run:
   ```bash
   cd backend
   npm run setup-user
   ```
5. Follow the prompts

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
curl -X POST https://your-backend.railway.app/api/auth/register \
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

You can create multiple users by running `npm run setup-user` multiple times. Each user will be added to the `data/users.json` file.

## Troubleshooting

**"User already exists" error:**
- The username is already taken
- Choose a different username

**"Password must be at least 6 characters":**
- Your password is too short
- Use at least 6 characters

**Can't find `data/users.json`:**
- The file will be created automatically when you run the setup script
- Make sure the `data` directory exists (it will be created automatically)

**Forgot password:**
- Currently, there's no password reset feature
- You can create a new user with a different username
- Or manually edit `data/users.json` to change the password hash (requires generating a new hash)
