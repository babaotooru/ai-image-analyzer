import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import sharp from 'sharp';
import { hashBuffer } from '../../lib/hashImage';
import { addEntry, findSimilar } from '../../lib/vectorStore';
import { saveAnalysis } from '../../lib/database';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const EMB_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const MAX_SIMILAR = parseInt(process.env.MAX_SIMILAR || '3', 10);
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true' || !process.env.OPENAI_API_KEY;

// Lazy initialization of OpenAI client - only create when needed
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  try {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (err) {
    console.error('Error creating OpenAI client:', err);
    return null;
  }
}

// Generate mock analysis data for testing
function generateMockAnalysis(imageBuffer, filename) {
  return {
    imageSummary: "This is a sample image analysis. The image appears to contain visual elements that have been processed for demonstration purposes.",
    detectedElements: [
      "Sample object 1",
      "Sample object 2",
      "Text or labels",
      "Background elements"
    ],
    detailedExplanation: "This is a mock analysis generated for testing purposes. To get real analysis, please set your OPENAI_API_KEY in .env.local file. The image has been successfully uploaded and processed. You can see various elements in the image that would normally be analyzed by the AI vision model.",
    realWorldApplications: "This mock data demonstrates the structure of the analysis output. Real analysis would provide detailed insights about the image's content, context, and practical applications.",
    educationalInsight: "This is a demonstration of the image analysis system. With a valid OpenAI API key, you would receive comprehensive analysis including object detection, text extraction, color analysis, and contextual understanding.",
    confidenceLevel: "Medium",
    domain: "General",
    extractedText: "Sample text extraction would appear here",
    colors: "Various colors detected in the image",
    environment: "Indoor/Outdoor setting",
    people: "No people detected in this sample",
    technicalDetails: "Image processed successfully. Mock mode active.",
    related: []
  };
}

// Helper: send SSE event
function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush if available
    if (typeof res.flush === 'function') {
      res.flush();
    }
  } catch (err) {
    console.error('Error sending SSE event:', err);
  }
}

export default async function handler(req, res) {
  // SSE only for GET
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Only GET allowed for SSE' });
    return;
  }

  const id = req.query.id;
  if (!id) {
    res.status(400).json({ error: 'Missing id query parameter' });
    return;
  }

  // Set SSE headers FIRST before any operations - CRITICAL
  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event immediately
    sseSend(res, 'progress', { type: 'progress', msg: 'Connection established' });
  } catch (headerError) {
    console.error('Error setting SSE headers:', headerError);
    res.status(500).json({ error: 'Failed to establish connection' });
    return;
  }

  const uploadsDir = path.join(process.cwd(), 'tmp_uploads');
  
  // Ensure directory exists
  if (!fs.existsSync(uploadsDir)) {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create uploads directory:', err);
      sseSend(res, 'error', { type: 'error', error: 'Cannot create uploads directory' });
      res.end();
      return;
    }
  }

  // Find matching file
  let files;
  try {
    files = fs.readdirSync(uploadsDir);
  } catch (err) {
    console.error('Error reading uploads directory:', err);
    sseSend(res, 'error', { type: 'error', error: 'Cannot read uploads directory' });
    res.end();
    return;
  }

  const match = files.find(f => f.startsWith(id));
  
  if (!match) {
    console.error('File not found for id:', id, 'Available files:', files.slice(0, 5));
    sseSend(res, 'error', { type: 'error', error: 'Upload not found. Please upload the image again.' });
    res.end();
    return;
  }
  
  const filepath = path.join(uploadsDir, match);

  try {
    sseSend(res, 'progress', { type: 'progress', msg: 'Reading uploaded file' });

    // Read file
    let buffer;
    if (!fs.existsSync(filepath)) {
      sseSend(res, 'error', { type: 'error', error: 'File not found on server' });
      res.end();
      return;
    }

    buffer = fs.readFileSync(filepath);

    sseSend(res, 'progress', { type: 'progress', msg: 'Extracting image properties...' });
    
    // Extract image metadata using Sharp
    let imageMetadata = {};
    let originalDimensions = { width: 0, height: 0 };
    let imageFormat = 'unknown';
    let hasAlpha = false;
    let colorSpace = 'unknown';
    
    try {
      const metadata = await sharp(buffer).metadata();
      originalDimensions = {
        width: metadata.width || 0,
        height: metadata.height || 0
      };
      imageFormat = metadata.format || 'unknown';
      hasAlpha = metadata.hasAlpha || false;
      colorSpace = metadata.space || 'unknown';
      imageMetadata = {
        format: imageFormat,
        width: originalDimensions.width,
        height: originalDimensions.height,
        channels: metadata.channels || 3,
        hasAlpha: hasAlpha,
        colorSpace: colorSpace,
        density: metadata.density || null,
        orientation: metadata.orientation || 1,
        fileSize: buffer.length,
        fileSizeMB: (buffer.length / (1024 * 1024)).toFixed(2)
      };
    } catch (metaError) {
      console.error('Error extracting metadata:', metaError);
      imageMetadata = {
        format: 'unknown',
        width: 0,
        height: 0,
        fileSize: buffer.length,
        fileSizeMB: (buffer.length / (1024 * 1024)).toFixed(2)
      };
    }
    
    sseSend(res, 'progress', { type: 'progress', msg: `Image: ${originalDimensions.width}x${originalDimensions.height} ${imageFormat.toUpperCase()}, ${imageMetadata.fileSizeMB}MB` });
    
    // Resize and convert to JPEG for AI analysis
    const resized = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    
    const hash = await hashBuffer(resized);

    sseSend(res, 'progress', { type: 'progress', msg: 'Calling vision model for comprehensive analysis' });

    const dataUrl = `data:image/jpeg;base64,${resized.toString('base64')}`;
    
    // Enhanced vision prompt with image properties context
    const visionPrompt = `You are an expert AI image analyzer. Your task is to analyze this image and describe EXACTLY what it contains in comprehensive detail.

IMAGE PROPERTIES:
- Dimensions: ${originalDimensions.width}x${originalDimensions.height} pixels
- Format: ${imageFormat.toUpperCase()}
- File Size: ${imageMetadata.fileSizeMB} MB
- Color Space: ${colorSpace}
- Has Transparency: ${hasAlpha ? 'Yes' : 'No'}

CRITICAL INSTRUCTIONS:
1. Look at the image carefully and describe EVERYTHING you see
2. Extract ALL text visible in the image (OCR) - copy it exactly as it appears
3. List EVERY object, item, person, or element visible
4. Describe the scene, setting, and context in detail
5. Be specific and detailed - don't use generic descriptions

ANALYSIS REQUIREMENTS - Provide a comprehensive analysis covering ALL of the following:

1. MAIN SUBJECT: What is the primary subject or focus? Describe in complete detail. What exactly is shown?

2. ALL OBJECTS & ELEMENTS: List EVERY visible object, item, tool, device, or thing. Be exhaustive and specific. For example:
   - Furniture, electronics, vehicles, tools, etc.
   - Natural elements (trees, water, sky, etc.)
   - Buildings, structures, architectural elements
   - Any physical objects you can identify

3. PEOPLE: If people are present, describe:
   - Exact number of people
   - Approximate ages, genders, ethnicities
   - Detailed appearance, clothing, expressions
   - Actions and activities they are performing
   - Body language, poses, interactions
   - If no people, state "No people detected"

4. TEXT & SYMBOLS (OCR) - MOST IMPORTANT: Extract ALL text exactly as it appears in the image:
   - Read every word, number, letter visible
   - Copy text exactly as written (preserve spelling, capitalization)
   - Include all symbols, logos, signs, labels
   - Include any numbers, codes, or markings
   - If text appears in multiple places, list all locations
   - FOR E-COMMERCE IMAGES: Extract product names, prices, descriptions, brand names, model numbers, specifications, discount text, promotional messages, "Buy Now", "Add to Cart", ratings, reviews, etc.
   - Format: "Text found: [exact text content]"
   - If no text is visible, state "No text detected in image"

5. COLORS: Describe in detail:
   - Dominant colors (name specific colors)
   - Color scheme and palette
   - Color patterns and gradients
   - Color temperature (warm/cool)
   - Saturation and brightness levels

6. ENVIRONMENT & SETTING: Describe:
   - Location type (indoor/outdoor/vehicle/etc.)
   - Specific background details
   - Time of day (if discernible from lighting)
   - Weather conditions (if visible)
   - Context and setting details

7. COMPOSITION: Analyze:
   - Layout and arrangement of elements
   - Perspective and camera angle
   - Framing and focus points
   - Visual balance and composition

8. DOMAIN/CATEGORY: Identify the specific category:
   - medical, education, product, document, diagram, nature, traffic, agriculture, engineering, daily life, art, technology, food, architecture, fashion, sports, entertainment, business, etc.

9. PROCESS/WORKFLOW: If showing a process/diagram/workflow:
   - Explain every step in detail
   - Identify the sequence and flow
   - Describe relationships between elements

10. OBJECT/PRODUCT ANALYSIS: If showing an object/product:
    - Exact identification (what is it called?)
    - How it works or functions
    - All visible components and parts
    - Real-world use cases
    - Any visible features or characteristics

11. EMOTIONS & MOOD: What emotions or mood does the image convey?

12. TECHNICAL DETAILS: Assess:
    - Image quality and clarity
    - Lighting conditions
    - Focus and sharpness
    - Any visible artifacts or issues

13. CONTEXT & MEANING: What is the likely purpose, context, or meaning of this image?

14. UNUSUAL FEATURES: Note any unusual, interesting, or noteworthy features.

OUTPUT FORMAT:
Provide a detailed, structured response that clearly describes:
- What the image shows (main content)
- All visible objects and elements
- All extracted text (if any)
- The scene, setting, and context
- Any other relevant details

CRITICAL: Be extremely accurate. Only describe what you can actually see. Do not guess or hallucinate. Extract maximum information from the image. If you see text, copy it exactly.`;

    // Check if we should use mock data
    let outputText = '';
    let useMock = USE_MOCK_DATA;
    
    if (useMock) {
      sseSend(res, 'progress', { type: 'progress', msg: 'Using mock data mode (no API key required)...' });
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      sseSend(res, 'progress', { type: 'progress', msg: 'Generating mock analysis...' });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const mockAnalysis = generateMockAnalysis(buffer, match);
      outputText = `Mock Analysis:\n\n${mockAnalysis.imageSummary}\n\n${mockAnalysis.detailedExplanation}\n\nDetected Elements: ${mockAnalysis.detectedElements.join(', ')}\n\nColors: ${mockAnalysis.colors}\n\nEnvironment: ${mockAnalysis.environment}\n\nDomain: ${mockAnalysis.domain}`;
      
      sseSend(res, 'progress', { type: 'progress', msg: 'Mock analysis complete' });
    } else {
      // Get client (lazy initialization)
      const client = getClient();
      if (!client) {
        sseSend(res, 'progress', { type: 'progress', msg: 'API key not found, switching to mock data mode...' });
        await new Promise(resolve => setTimeout(resolve, 500));
        const mockAnalysis = generateMockAnalysis(buffer, match);
        outputText = `Mock Analysis:\n\n${mockAnalysis.imageSummary}\n\n${mockAnalysis.detailedExplanation}\n\nDetected Elements: ${mockAnalysis.detectedElements.join(', ')}\n\nColors: ${mockAnalysis.colors}\n\nEnvironment: ${mockAnalysis.environment}\n\nDomain: ${mockAnalysis.domain}`;
        useMock = true;
      } else {
        try {
          sseSend(res, 'progress', { type: 'progress', msg: 'Calling OpenAI vision model (this may take 10-30 seconds)...' });
          
          const response = await client.chat.completions.create({
            model: 'gpt-4o', // Using gpt-4o for best vision analysis accuracy
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: visionPrompt
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: dataUrl,
                      detail: 'high' // High detail for better analysis
                    }
                  }
                ]
              }
            ],
            max_tokens: 4000, // Increased for more detailed analysis
            temperature: 0.1 // Lower temperature for more accurate analysis
          });

          // Extract output text
          if (response && response.choices && response.choices.length > 0) {
            outputText = response.choices[0].message.content || '';
          }
          
          if (!outputText || outputText.trim().length === 0) {
            console.error('No output from vision model:', response);
            outputText = 'Vision analysis returned no content. Please try again.';
            sseSend(res, 'progress', { type: 'progress', msg: 'Warning: Vision model returned empty response' });
          } else {
            sseSend(res, 'progress', { type: 'progress', msg: 'Vision analysis received successfully (' + outputText.length + ' characters)' });
          }
        } catch (apiError) {
          console.error('OpenAI API error:', apiError);
          let errorMsg = 'OpenAI API error';
          
          if (apiError.message) {
            errorMsg = apiError.message;
          } else if (apiError.error && apiError.error.message) {
            errorMsg = apiError.error.message;
          } else if (apiError.response) {
            errorMsg = apiError.response.statusText || 'API request failed';
          }
          
          // Provide helpful error messages
          if (errorMsg.includes('API key') || errorMsg.includes('Invalid') || errorMsg.includes('401')) {
            errorMsg = 'OpenAI API key is missing or invalid. Please check your .env.local file and ensure OPENAI_API_KEY is set correctly.';
          } else if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
            errorMsg = 'OpenAI API rate limit exceeded. Please try again in a moment.';
          } else if (errorMsg.includes('insufficient_quota') || errorMsg.includes('quota')) {
            errorMsg = 'OpenAI API quota exceeded. Please add credits to your OpenAI account.';
          } else if (errorMsg.includes('model')) {
            errorMsg = 'OpenAI model error. The model might not be available. Try changing to gpt-4o-mini in the code.';
          }
          
          console.error('Detailed API error:', {
            message: errorMsg,
            error: apiError,
            stack: apiError.stack
          });
          
          sseSend(res, 'error', { type: 'error', error: errorMsg });
          
          // Don't continue - return error
          sseSend(res, 'progress', { type: 'progress', msg: 'Analysis failed due to API error' });
          await new Promise(resolve => setTimeout(resolve, 200));
          res.end();
          return;
        }
      }
    }

    // Extract text from vision analysis output
    let extractedTextFromVision = '';
    if (outputText && outputText.length > 0) {
      // Look for text patterns in the vision output
      const textPatterns = [
        /text found[:\s]+(.*?)(?:\n|$)/gi,
        /text[:\s]+(.*?)(?:\n|$)/gi,
        /ocr[:\s]+(.*?)(?:\n|$)/gi,
        /extracted text[:\s]+(.*?)(?:\n|$)/gi,
        /visible text[:\s]+(.*?)(?:\n|$)/gi,
        /words[:\s]+(.*?)(?:\n|$)/gi,
        /letters[:\s]+(.*?)(?:\n|$)/gi
      ];
      
      for (const pattern of textPatterns) {
        const matches = outputText.match(pattern);
        if (matches && matches.length > 0) {
          extractedTextFromVision = matches.map(m => m.replace(pattern, '$1').trim()).join(' ').trim();
          if (extractedTextFromVision.length > 10) break;
        }
      }
      
      // If no pattern match, look for quoted text or text after "TEXT" section
      if (!extractedTextFromVision || extractedTextFromVision.length < 10) {
        const textSection = outputText.match(/4\.\s*TEXT[^\n]*\n([\s\S]*?)(?=\n\s*5\.|$)/i);
        if (textSection && textSection[1]) {
          extractedTextFromVision = textSection[1]
            .replace(/[-•*]\s*/g, '')
            .replace(/text found[:\s]+/gi, '')
            .trim();
        }
      }
      
      // Fallback: extract any text-like content (words, numbers, common patterns)
      if (!extractedTextFromVision || extractedTextFromVision.length < 5) {
        // Look for e-commerce patterns (prices, product names, etc.)
        const ecommercePatterns = [
          /\$\d+[\d,.]*/g,  // Prices
          /₹\d+[\d,.]*/g,   // Rupees
          /€\d+[\d,.]*/g,   // Euros
          /£\d+[\d,.]*/g,   // Pounds
          /\d+% (?:OFF|DISCOUNT|SAVE)/gi,  // Discounts
          /(?:BUY|SHOP|ORDER|ADD TO CART|PRICE|SALE)/gi,  // E-commerce keywords
        ];
        
        const foundTexts = [];
        for (const pattern of ecommercePatterns) {
          const matches = outputText.match(pattern);
          if (matches) foundTexts.push(...matches);
        }
        
        if (foundTexts.length > 0) {
          extractedTextFromVision = foundTexts.join(' ');
        }
      }
    }

    const caption = (outputText.split('\n')[0] || outputText.slice(0, 150) || 'Image analysis').trim();

    // Log extracted text for debugging
    if (extractedTextFromVision) {
      console.log('Extracted text from vision analysis:', extractedTextFromVision.substring(0, 200));
      sseSend(res, 'progress', { type: 'progress', msg: `Text extracted: ${extractedTextFromVision.substring(0, 50)}...` });
    }

    sseSend(res, 'progress', { type: 'progress', msg: 'Vision analysis complete' });
    sseSend(res, 'partial', { type: 'partial', text: `Initial analysis: ${caption}` });

    // Handle embedding and vector store
    let embedding = [];
    let related = [];
    
    if (useMock) {
      // Generate mock embedding (dummy vector)
      embedding = new Array(1536).fill(0).map(() => Math.random() * 0.1 - 0.05);
      sseSend(res, 'progress', { type: 'progress', msg: 'Skipping embedding (mock mode)' });
    } else {
      const client = getClient();
      if (client) {
        try {
          sseSend(res, 'progress', { type: 'progress', msg: 'Creating embedding' });
          const summary = `${caption} -- Analysis: ${outputText.slice(0, 1000)}`;
          const embResp = await client.embeddings.create({ model: EMB_MODEL, input: summary });
          embedding = embResp.data[0].embedding;

          sseSend(res, 'progress', { type: 'progress', msg: 'Storing in vector store' });
          addEntry({ id: hash, summary, embedding, ts: Date.now(), meta: {} });

          sseSend(res, 'progress', { type: 'progress', msg: 'Finding similar images' });
          related = findSimilar(embedding, MAX_SIMILAR);
        } catch (embError) {
          console.error('Embedding error:', embError);
          embedding = new Array(1536).fill(0);
        }
      }
    }

    sseSend(res, 'progress', { type: 'progress', msg: 'Formatting comprehensive analysis' });
    sseSend(res, 'partial', { type: 'partial', text: 'Generating detailed structured output...' });

    const relatedText = (related && related.length > 0)
      ? related.map(r => `- ${r.summary} (similarity: ${r.score.toFixed(3)})`).join('\n')
      : 'None';
    
    const formattingPrompt = `You are an expert AI Image Analyzer specializing in extracting ALL content from images, especially e-commerce product details, text, prices, and descriptions.

VISION MODEL DETAILED ANALYSIS:
${outputText}

RELATED SIMILAR IMAGES (for context):
${relatedText}

EXTRACTED TEXT FROM VISION (if found):
${extractedTextFromVision || 'No text extracted yet'}

Based on the comprehensive vision analysis above, create a detailed JSON object with this EXACT structure. Return ONLY valid JSON:

{
  "imageSummary": "A comprehensive 3-5 sentence summary describing EXACTLY what this image shows. If it's an e-commerce/product image, mention product name, price, brand, and key features. Be specific about what's actually visible.",
  "detectedElements": ["Complete", "list", "of", "ALL", "objects", "items", "products", "people", "text", "symbols", "colors", "components", "features", "visible", "in", "the", "image"],
  "detailedExplanation": "A very detailed explanation (10-20 sentences) that describes EXACTLY what the image contains. For e-commerce images, include: product name, brand, price, description, features, specifications, any text on labels/tags, promotional text, discount information, etc. For other images, describe all visible objects, the scene, people, text, colors, environment, and context. Be extremely specific and descriptive.",
  "realWorldApplications": "Detailed practical use cases, applications, or relevance of what's shown in the image (3-5 sentences)",
  "educationalInsight": "What can someone learn from this image? What knowledge or insights does it provide? (3-5 sentences)",
  "confidenceLevel": "High",
  "domain": "The specific domain/category (e.g., e-commerce, product, medical, education, document, diagram, nature, traffic, agriculture, engineering, daily life, art, technology, food, architecture, etc.)",
  "extractedText": "ALL text found in the image, extracted from the vision analysis. Include: product names, prices, descriptions, labels, tags, promotional text, any written content. Copy text EXACTLY as it appears. If the vision analysis mentions text, extract ALL of it here. Format as readable text with line breaks if multiple text elements. If no text found, use empty string \"\"",
  "colors": "Detailed description of dominant colors and color scheme visible in the image",
  "environment": "Detailed description of the setting, location, and surroundings visible in the image",
  "people": "Detailed description of any people present, their appearance, actions, and characteristics. If no people, state \"No people detected\"",
  "technicalDetails": "Image quality, lighting, composition, and technical aspects"
}

CRITICAL RULES:
1. Extract EVERY detail from the vision analysis - don't miss anything
2. The "detailedExplanation" field MUST describe what the image actually contains - be specific about objects, scenes, people, text, etc. This is the most important field - it should comprehensively describe the image content.
3. The "detectedElements" array MUST include ALL objects, items, and elements mentioned in the vision analysis
4. The "extractedText" field MUST contain ALL text found in the image (from the vision analysis). If text was found, copy it exactly. If no text, use empty string.
5. Be comprehensive and thorough - describe everything visible
6. Use simple English but be detailed and specific
7. Do NOT hallucinate - only use information from the vision analysis
8. Make detectedElements a COMPLETE list of everything visible
9. Be specific and detailed in all fields - describe what's actually in the image
10. Return ONLY valid JSON, no markdown, no code blocks, no explanations

IMPORTANT: The "detailedExplanation" should read like a comprehensive description of the image content that tells someone exactly what they would see if they looked at the image. It should describe all visible objects, the scene, people, text, colors, environment, and context.`;

    let llm;
    if (useMock) {
      // Use mock data directly
      const mockAnalysis = generateMockAnalysis(buffer, match);
      llm = {
        choices: [{
          message: {
            content: JSON.stringify(mockAnalysis)
          }
        }]
      };
      sseSend(res, 'progress', { type: 'progress', msg: 'Using mock formatted data' });
    } else {
      const client = getClient();
      if (!client) {
        // Fallback to mock
        const mockAnalysis = generateMockAnalysis(buffer, match);
        llm = {
          choices: [{
            message: {
              content: JSON.stringify(mockAnalysis)
            }
          }]
        };
        sseSend(res, 'progress', { type: 'progress', msg: 'Using mock formatted data (no API key)' });
      } else {
        try {
          llm = await client.chat.completions.create({
            model: MODEL,
            messages: [
              { 
                role: 'system', 
                content: 'You are an expert AI assistant that extracts maximum information from images. Always return valid JSON without any markdown formatting, code blocks, or extra text.' 
              },
              { role: 'user', content: formattingPrompt }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 3000,
            temperature: 0.2
          });
        } catch (formatError) {
          console.error('Formatting error:', formatError);
          // Fallback to mock
          const mockAnalysis = generateMockAnalysis(buffer, match);
          llm = {
            choices: [{
              message: {
                content: JSON.stringify(mockAnalysis)
              }
            }]
          };
        }
      }
    }

    let llmText = '';
    try {
      llmText = llm.choices?.[0]?.message?.content || llm.choices?.[0]?.text || '';
    } catch (e) {
      llmText = JSON.stringify(llm);
    }

    let parsed = {};
    try {
      let cleanText = llmText.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/```\n?/g, '').trim();
      }
      cleanText = cleanText.trim();
      parsed = JSON.parse(cleanText);

      if (!parsed.imageSummary || typeof parsed.imageSummary !== 'string') {
        parsed.imageSummary = caption || 'Image analysis completed';
      }
      if (!parsed.detectedElements || !Array.isArray(parsed.detectedElements)) parsed.detectedElements = [];
      if (!parsed.detailedExplanation || typeof parsed.detailedExplanation !== 'string') {
        parsed.detailedExplanation = outputText.slice(0, 500);
      }
      if (!parsed.realWorldApplications || typeof parsed.realWorldApplications !== 'string') {
        parsed.realWorldApplications = 'Analysis available';
      }
      if (!parsed.educationalInsight || typeof parsed.educationalInsight !== 'string') {
        parsed.educationalInsight = 'See detailed explanation above';
      }
      if (!parsed.confidenceLevel || !['High', 'Medium', 'Low'].includes(parsed.confidenceLevel)) {
        parsed.confidenceLevel = 'Medium';
      }
      if (!parsed.domain || typeof parsed.domain !== 'string') parsed.domain = 'Unknown';
      // Enhanced text extraction - use extracted text from vision if available
      if (!parsed.extractedText || typeof parsed.extractedText !== 'string' || parsed.extractedText.trim().length === 0) {
        // Try to extract from vision output directly
        if (extractedTextFromVision && extractedTextFromVision.trim().length > 0) {
          parsed.extractedText = extractedTextFromVision.trim();
        } else {
          // Look for text in the raw outputText
          const textMatches = outputText.match(/(?:text|words|letters|ocr)[:\s]+([^\n]+)/gi);
          if (textMatches && textMatches.length > 0) {
            parsed.extractedText = textMatches.map(m => m.replace(/(?:text|words|letters|ocr)[:\s]+/gi, '').trim()).join(' ').trim();
          } else {
            parsed.extractedText = '';
          }
        }
      }
      if (!parsed.colors || typeof parsed.colors !== 'string') parsed.colors = 'Not specified';
      if (!parsed.environment || typeof parsed.environment !== 'string') parsed.environment = 'Not specified';
      if (!parsed.people || typeof parsed.people !== 'string') parsed.people = 'Not specified';
      if (!parsed.technicalDetails || typeof parsed.technicalDetails !== 'string') parsed.technicalDetails = 'Not specified';
    } catch (e) {
      console.error('JSON parsing error:', e, 'Raw text:', llmText.substring(0, 200));
      parsed = {
        imageSummary: caption || 'Image analysis completed',
        detectedElements: [],
        detailedExplanation: llmText || outputText.slice(0, 500),
        realWorldApplications: 'Analysis available',
        educationalInsight: 'See detailed explanation above',
        confidenceLevel: 'Medium',
        domain: 'Unknown',
        extractedText: '',
        colors: 'Not specified',
        environment: 'Not specified',
        people: 'Not specified',
        technicalDetails: 'Not specified'
      };
    }

    const finalResult = {
      id,
      imageSummary: parsed.imageSummary,
      detectedElements: parsed.detectedElements,
      detailedExplanation: parsed.detailedExplanation,
      realWorldApplications: parsed.realWorldApplications,
      educationalInsight: parsed.educationalInsight,
      confidenceLevel: parsed.confidenceLevel,
      domain: parsed.domain,
      extractedText: parsed.extractedText,
      colors: parsed.colors,
      environment: parsed.environment,
      people: parsed.people,
      technicalDetails: parsed.technicalDetails,
      related,
      filename: match || 'upload',
      fileSize: buffer.length,
      timestamp: new Date().toISOString(),
      imageDataUrl: dataUrl, // Include the processed image data URL
      isMockData: useMock, // Flag to indicate if this is mock data
      // Image properties
      imageProperties: {
        ...imageMetadata,
        aspectRatio: originalDimensions.width > 0 && originalDimensions.height > 0 
          ? (originalDimensions.width / originalDimensions.height).toFixed(2) 
          : '0:0',
        megapixels: originalDimensions.width > 0 && originalDimensions.height > 0
          ? ((originalDimensions.width * originalDimensions.height) / 1000000).toFixed(2)
          : '0'
      }
    };

    // Save to database
    try {
      const savedAnalysis = saveAnalysis({
        ...finalResult,
        filename: 'upload',
        embedding
      });
      finalResult.dbId = savedAnalysis.id;
      finalResult.savedAt = savedAnalysis.timestamp;
    } catch (dbError) {
      console.error('Database save error:', dbError);
    }

    sseSend(res, 'progress', { type: 'progress', msg: 'Analysis complete and saved' });
    
    // Send done event
    const donePayload = { 
      type: 'done', 
      result: finalResult 
    };
    sseSend(res, 'done', donePayload);

    // Wait before closing
    await new Promise(resolve => setTimeout(resolve, 300));
    
    res.end();
  } catch (err) {
    console.error('Stream analyze error:', err);
    let errorMsg = 'An error occurred during analysis';
    
    // Extract detailed error message
    if (err.message) {
      errorMsg = err.message;
    } else if (err.error && err.error.message) {
      errorMsg = err.error.message;
    } else if (typeof err === 'string') {
      errorMsg = err;
    }
    
    // Provide helpful context
    if (errorMsg.includes('ENOENT') || errorMsg.includes('not found')) {
      errorMsg = 'File not found. Please upload the image again.';
    } else if (errorMsg.includes('permission') || errorMsg.includes('EACCES')) {
      errorMsg = 'Permission denied. Please check file permissions.';
    } else if (errorMsg.includes('API key') || errorMsg.includes('OPENAI')) {
      errorMsg = 'OpenAI API error. Please check your API key in .env.local';
    } else if (errorMsg.includes('sharp') || errorMsg.includes('image')) {
      errorMsg = 'Image processing error. Please ensure the file is a valid image.';
    }
    
    console.error('Error details:', {
      message: errorMsg,
      stack: err.stack,
      name: err.name,
      fullError: err
    });
    
    try {
      sseSend(res, 'progress', { type: 'progress', msg: 'Error occurred: ' + errorMsg });
      sseSend(res, 'error', { type: 'error', error: errorMsg });
    } catch (sendErr) {
      console.error('Error sending error event:', sendErr);
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      res.end();
    } catch (endErr) {
      console.error('Error ending response:', endErr);
    }
  }
}
