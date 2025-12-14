# AI Image Analyzer

An intelligent image analysis application that extracts maximum meaningful information from uploaded images using OpenAI's vision models. The analyzer identifies objects, people, text, symbols, colors, environment, and context, then provides detailed explanations, real-world applications, and educational insights.

## Features

- **Comprehensive Image Analysis**: Identifies all visible objects, people, text, symbols, colors, environment, and context
- **Domain Detection**: Automatically detects image category (medical, education, product, document, diagram, nature, traffic, agriculture, engineering, daily life, etc.)
- **OCR Text Extraction**: Accurately extracts and explains all text present in images
- **Process/Diagram Explanation**: Step-by-step explanations for workflows, diagrams, and processes
- **Product/Object Analysis**: Detailed information about objects including how they work, use cases, and safety considerations
- **Structured Output**: Well-formatted results with:
  - Image Summary
  - Detected Elements
  - Detailed Explanation
  - Real-World Applications
  - Educational Insights
  - Confidence Level
- **Real-time Analysis**: Streaming updates during analysis process
- **Vector Store**: Local storage of image embeddings for similarity search

## Prerequisites

- Node.js 18+ and npm
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

## Installation

1. **Clone or navigate to the project directory**
   ```bash
   cd ai-image-analyzer
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in the root directory:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   
   # Optional: Customize models
   OPENAI_MODEL=gpt-4o-mini
   EMBEDDING_MODEL=text-embedding-3-small
   MAX_SIMILAR=3
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000`

## Usage

1. **Upload an Image**: Click the file input and select an image file
2. **Analyze**: Click "Analyze (Realtime)" for streaming updates or "Analyze (Normal)" for standard analysis
3. **View Results**: The analysis will display in a structured format with:
   - Image summary and domain
   - All detected elements
   - Extracted text (if any)
   - Detailed explanation
   - Real-world applications
   - Educational insights
   - Confidence level

## Project Structure

```
ai-image-analyzer/
├── lib/
│   ├── hashImage.js      # Image hashing utilities
│   └── vectorStore.js    # Local vector store for embeddings
├── pages/
│   ├── api/
│   │   ├── analyze.js           # Main analysis endpoint
│   │   ├── analyze-stream.js    # Streaming analysis endpoint
│   │   └── upload-temp.js       # Temporary file upload handler
│   └── index.jsx                # Main UI component
├── public/                      # Static assets
├── .env.local                   # Environment variables (create this)
├── .gitignore                   # Git ignore rules
├── next.config.js              # Next.js configuration
├── package.json                # Dependencies
└── README.md                   # This file
```

## How It Works

1. **Image Upload**: User uploads an image through the web interface
2. **Image Processing**: Image is resized and converted to base64
3. **Vision Analysis**: OpenAI's vision model (`gpt-image-1`) analyzes the image comprehensively
4. **Embedding Generation**: Creates embeddings for similarity search
5. **Vector Store**: Saves analysis to local vector store
6. **Similarity Search**: Finds similar previously analyzed images
7. **Structured Formatting**: LLM formats the analysis into structured output
8. **Display**: Results are displayed in a user-friendly format

## API Endpoints

### POST `/api/analyze`
Standard analysis endpoint that returns complete results.

**Request**: FormData with `image` field

**Response**: JSON with structured analysis

### GET `/api/analyze-stream?id={uploadId}`
Streaming analysis endpoint using Server-Sent Events (SSE).

**Query Parameters**:
- `id`: Upload ID from `/api/upload-temp`

**Response**: SSE stream with progress updates and final result

### POST `/api/upload-temp`
Temporary file upload for streaming analysis.

**Request**: FormData with `image` field

**Response**: JSON with `ok`, `id`, and `path`

## Configuration

### Environment Variables

- `OPENAI_API_KEY` (required): Your OpenAI API key
- `OPENAI_MODEL` (optional): Chat model for formatting (default: `gpt-4o-mini`)
- `EMBEDDING_MODEL` (optional): Embedding model (default: `text-embedding-3-small`)
- `MAX_SIMILAR` (optional): Number of similar images to retrieve (default: `3`)
- `VECTOR_STORE_PATH` (optional): Path to vector store JSON file

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the repository in Vercel
3. Add environment variables in Vercel dashboard:
   - `OPENAI_API_KEY`
   - (Optional) Other configuration variables
4. Deploy

### Other Platforms

The application can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- AWS Amplify
- DigitalOcean App Platform

Make sure to set all required environment variables in your deployment platform.

## Notes & Limitations

- **Local Vector Store**: This demo uses a local JSON file (`vectorStore.json`) for simplicity. For production, consider using:
  - Pinecone
  - Weaviate
  - FAISS
  - Qdrant
  - Chroma

- **Image Size**: Images are automatically resized to max 1024x1024 to reduce API payload

- **Model Support**: Uses OpenAI's `gpt-image-1` for vision analysis. Ensure your API key has access to this model.

- **Rate Limits**: Be aware of OpenAI API rate limits and costs

## Security

- **Never commit** `.env.local` or API keys to version control
- API keys are only used server-side
- Consider adding:
  - User authentication
  - Rate limiting
  - Image size limits
  - File type validation
  - User consent and data deletion options

## Troubleshooting

### "No image uploaded" error
- Ensure you're selecting a valid image file
- Check file size limits

### API errors
- Verify your `OPENAI_API_KEY` is correct
- Check your OpenAI account has sufficient credits
- Ensure you have access to the required models

### Build errors
- Run `npm install` to ensure all dependencies are installed
- Check Node.js version (requires 18+)

## Contributing

Feel free to submit issues, fork the repository, and create pull requests for any improvements.

## License

This project is open source and available for use and modification.

## Support

For issues or questions, please open an issue on the repository.
