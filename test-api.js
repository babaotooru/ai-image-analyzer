// Quick test script to verify OpenAI API setup
require('dotenv').config({ path: '.env.local' });

const OpenAI = require('openai');

console.log('Testing OpenAI API setup...\n');

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ ERROR: OPENAI_API_KEY is not set in .env.local');
  console.log('\nPlease create .env.local file with:');
  console.log('OPENAI_API_KEY=your_api_key_here');
  process.exit(1);
}

console.log('✅ OPENAI_API_KEY is set');
console.log('Key starts with:', process.env.OPENAI_API_KEY.substring(0, 7) + '...');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Test a simple API call
async function testAPI() {
  try {
    console.log('\nTesting OpenAI API connection...');
    const response = await client.models.list();
    console.log('✅ API connection successful!');
    console.log('Available models:', response.data.slice(0, 5).map(m => m.id).join(', '));
  } catch (err) {
    console.error('❌ API connection failed:', err.message);
    if (err.message.includes('401') || err.message.includes('Invalid')) {
      console.error('\nYour API key is invalid. Please check your .env.local file.');
    } else if (err.message.includes('quota') || err.message.includes('insufficient')) {
      console.error('\nYour API account has no credits. Please add credits to your OpenAI account.');
    }
    process.exit(1);
  }
}

testAPI();

