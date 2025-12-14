# Troubleshooting Guide

## Common Issues and Fixes

### 1. "Unknown error" or Connection Errors

**Symptoms:**
- Error: "Unknown error"
- Connection closed errors
- Retrying messages

**Solutions:**

#### Check API Key
1. Make sure `.env.local` exists in the root directory
2. Add your OpenAI API key:
   ```env
   OPENAI_API_KEY=sk-your-actual-key-here
   ```
3. Restart the dev server after adding the key

#### Test API Key
Run this command to test your API key:
```bash
npm run test-api
```

#### Check Server Logs
Look at your terminal where `npm run dev` is running. You should see detailed error messages.

### 2. "Connection failed" Errors

**Possible Causes:**
1. Server not running - Make sure `npm run dev` is running
2. Port conflict - Try a different port: `npm run dev -- -p 3001`
3. Network issues - Check your internet connection

**Fix:**
- Use "Analyze (Quick)" instead of "Analyze (Real-time)" - it's more reliable
- Check browser console (F12) for detailed errors
- Check server terminal for error messages

### 3. No Output Displayed

**Check:**
1. Browser console (F12) for JavaScript errors
2. Server terminal for API errors
3. Network tab in browser dev tools to see API responses

**Common Issues:**
- API key invalid or missing
- No credits in OpenAI account
- Model not available
- Network timeout

### 4. API Key Issues

**Error Messages:**
- "OPENAI_API_KEY is not set"
- "Invalid API key"
- "401 Unauthorized"

**Fix:**
1. Create `.env.local` file in root directory
2. Add: `OPENAI_API_KEY=sk-your-key-here`
3. Restart server: Stop (Ctrl+C) and run `npm run dev` again
4. Make sure there are no spaces around the `=` sign

### 5. Model Errors

**If you see model-related errors:**
- The code uses `gpt-4o-mini` by default
- If that doesn't work, try changing to `gpt-4o` in:
  - `pages/api/analyze.js` (line ~82)
  - `pages/api/analyze-stream.js` (line ~172)

### 6. File Upload Issues

**If upload fails:**
- Check that `tmp_uploads` directory exists
- Check file permissions
- Try a smaller image file
- Check server logs for file system errors

## Debugging Steps

1. **Check Environment:**
   ```bash
   # Windows PowerShell
   Get-Content .env.local
   
   # Should show:
   # OPENAI_API_KEY=sk-...
   ```

2. **Test API Connection:**
   ```bash
   npm run test-api
   ```

3. **Check Server Logs:**
   - Look at terminal where `npm run dev` is running
   - Look for error messages
   - Check for API key warnings

4. **Check Browser Console:**
   - Press F12
   - Go to Console tab
   - Look for red error messages
   - Check Network tab for failed requests

5. **Verify File Structure:**
   ```
   ai-image-analyzer/
   ├── .env.local          ← Must exist with API key
   ├── pages/
   │   ├── api/
   │   │   ├── analyze.js
   │   │   └── analyze-stream.js
   │   └── index.jsx
   └── package.json
   ```

## Quick Fixes

### If nothing works:
1. Stop the server (Ctrl+C)
2. Delete `node_modules` and `package-lock.json`
3. Run `npm install`
4. Make sure `.env.local` has your API key
5. Run `npm run dev`
6. Try "Analyze (Quick)" instead of real-time

### If API calls fail:
1. Verify API key at https://platform.openai.com/api-keys
2. Check account has credits
3. Verify API key has proper permissions
4. Try a new API key

## Getting Help

If issues persist:
1. Check browser console (F12) for errors
2. Check server terminal for errors
3. Run `npm run test-api` to verify API key
4. Share the error messages you see

