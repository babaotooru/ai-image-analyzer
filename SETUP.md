# Quick Setup Guide

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
OPENAI_API_KEY=sk-your-actual-api-key-here
```

Optional configuration:
```env
OPENAI_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
MAX_SIMILAR=3
```

## Step 3: Run the Development Server

```bash
npm run dev
```

## Step 4: Open in Browser

Navigate to: `http://localhost:3000`

## Step 5: Test the Application

1. Click "Choose File" and select an image
2. Click "Analyze (Realtime)" to see streaming progress
3. View the comprehensive analysis results

## Getting Your OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key and paste it in `.env.local`

## Troubleshooting

### Error: "OPENAI_API_KEY is not defined"
- Make sure `.env.local` exists in the root directory
- Verify the file contains `OPENAI_API_KEY=your_key_here`
- Restart the development server after creating/updating `.env.local`

### Error: "Module not found"
- Run `npm install` to install all dependencies

### Error: "Cannot find module 'sharp'"
- On some systems, you may need to install system dependencies for sharp
- Try: `npm rebuild sharp`

### Port already in use
- Change the port: `npm run dev -- -p 3001`

## Production Build

```bash
npm run build
npm start
```



