import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import sharp from 'sharp';
import { hashBuffer } from '../../lib/hashImage';
import { addEntry, findSimilar } from '../../lib/vectorStore';
import { saveAnalysis } from '../../lib/database';

export const config = { api: { bodyParser: false } };

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

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new formidable.IncomingForm();
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  try {
    const { files } = await parseForm(req);
    const file = files.image;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });

    // Read file buffer
    const buffer = fs.readFileSync(file.filepath || file.path);
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Invalid image file' });
    }

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

    // Resize to reduce payload while maintaining quality
    const resized = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    // Compute hash for caching
    const id = await hashBuffer(resized);

    // Convert to data URL
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
      console.log('Using mock data mode (no API key required)...');
      const mockAnalysis = generateMockAnalysis(buffer, file.originalFilename);
      outputText = `Mock Analysis:\n\n${mockAnalysis.imageSummary}\n\n${mockAnalysis.detailedExplanation}\n\nDetected Elements: ${mockAnalysis.detectedElements.join(', ')}\n\nColors: ${mockAnalysis.colors}\n\nEnvironment: ${mockAnalysis.environment}\n\nDomain: ${mockAnalysis.domain}`;
    } else {
      const client = getClient();
      if (!client) {
        console.log('API key not found, switching to mock data mode...');
        const mockAnalysis = generateMockAnalysis(buffer, file.originalFilename);
        outputText = `Mock Analysis:\n\n${mockAnalysis.imageSummary}\n\n${mockAnalysis.detailedExplanation}\n\nDetected Elements: ${mockAnalysis.detectedElements.join(', ')}\n\nColors: ${mockAnalysis.colors}\n\nEnvironment: ${mockAnalysis.environment}\n\nDomain: ${mockAnalysis.domain}`;
        useMock = true;
      } else {
        try {
          console.log('Calling vision model...');
          
          // Use correct OpenAI Vision API with best model for accuracy
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

          // Extract text output
          if (response && response.choices && response.choices.length > 0) {
            outputText = response.choices[0].message.content || '';
          }
          
          if (!outputText || outputText.trim().length === 0) {
            console.error('No output from vision model:', response);
            outputText = 'Vision analysis returned no content. Please try again.';
          }
        } catch (apiError) {
          console.error('OpenAI API error:', apiError);
          // Fallback to mock data on error
          const mockAnalysis = generateMockAnalysis(buffer, file.originalFilename);
          outputText = `Mock Analysis (API Error):\n\n${mockAnalysis.imageSummary}\n\n${mockAnalysis.detailedExplanation}`;
          useMock = true;
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

    // Extract caption from first line or first 150 chars
    const caption = (outputText.split('\n')[0] || outputText.slice(0, 150) || 'Image analysis').trim();

    console.log('Vision analysis complete, length:', outputText.length);
    if (extractedTextFromVision) {
      console.log('Extracted text from vision:', extractedTextFromVision.substring(0, 100));
    }

    // Build summary and get embedding
    let embedding = [];
    if (useMock) {
      // Generate mock embedding (dummy vector)
      embedding = new Array(1536).fill(0).map(() => Math.random() * 0.1 - 0.05);
    } else {
      const client = getClient();
      if (client) {
        try {
          const summary = `${caption} -- Analysis: ${outputText.slice(0, 1000)}`;
          const embResp = await client.embeddings.create({ 
            model: EMB_MODEL, 
            input: summary 
          });
          embedding = embResp.data[0].embedding;
        } catch (embError) {
          console.error('Embedding error:', embError);
          embedding = new Array(1536).fill(0);
        }
      }
    }

    // Save to vector store
    addEntry({ 
      id, 
      summary, 
      embedding, 
      ts: Date.now(), 
      meta: { filename: file.originalFilename || 'upload' } 
    });

    // Find similar images
    let related = [];
    if (!useMock && embedding.length > 0) {
      try {
        // Save to vector store
        addEntry({ 
          id, 
          summary: `${caption} -- Analysis: ${outputText.slice(0, 1000)}`, 
          embedding, 
          ts: Date.now(), 
          meta: { filename: file.originalFilename || 'upload' } 
        });
        related = findSimilar(embedding, MAX_SIMILAR);
      } catch (vecError) {
        console.error('Vector store error:', vecError);
      }
    }

    // Enhanced formatting prompt
    const relatedText = (related && related.length > 0)
      ? related.map(r => `- ${r.summary} (similarity: ${r.score.toFixed(3)})`).join('\n')
      : 'None';

    const formattingPrompt = `You are an expert AI Image Analyzer. Extract MAXIMUM meaningful information from the vision analysis.

VISION MODEL DETAILED ANALYSIS:
${outputText}

RELATED SIMILAR IMAGES (for context):
${relatedText}

Based on the comprehensive vision analysis above, create a detailed JSON object with this EXACT structure. Return ONLY valid JSON:

{
  "imageSummary": "A comprehensive 3-5 sentence summary describing what this image is, what it shows, and its main purpose",
  "detectedElements": ["Complete", "list", "of", "ALL", "objects", "items", "people", "text", "symbols", "colors", "components", "features", "visible", "in", "the", "image"],
  "detailedExplanation": "A very detailed explanation (5-10 sentences) suitable for beginners. If it's a process/diagram, explain EVERY step. If it's an object/product, explain what it is, ALL its parts, how it works, use cases, and safety considerations. Include all relevant details from the vision analysis.",
  "realWorldApplications": "Detailed practical use cases, applications, or relevance of what's shown in the image (3-5 sentences)",
  "educationalInsight": "What can someone learn from this image? What knowledge or insights does it provide? (3-5 sentences)",
  "confidenceLevel": "High",
  "domain": "The specific domain/category (e.g., medical, education, product, document, diagram, nature, traffic, agriculture, engineering, daily life, art, technology, food, architecture, etc.)",
  "extractedText": "ALL text found in the image, exactly as it appears, or empty string if none",
  "colors": "Description of dominant colors and color scheme",
  "environment": "Description of the setting, location, and surroundings",
  "people": "Description of any people present, their appearance, actions, and characteristics",
  "technicalDetails": "Image quality, lighting, composition, and technical aspects"
}

CRITICAL RULES:
- Extract EVERY detail from the vision analysis
- Be comprehensive and thorough
- Use simple English but be detailed
- Do NOT hallucinate - only use information from the vision analysis
- Make detectedElements a COMPLETE list of everything visible
- Include ALL extracted text exactly as it appears
- Be specific and detailed in all fields
- Return ONLY valid JSON, no markdown, no code blocks, no explanations`;

    let llm;
    if (useMock) {
      // Use mock data directly
      const mockAnalysis = generateMockAnalysis(buffer, file.originalFilename);
      llm = {
        choices: [{
          message: {
            content: JSON.stringify(mockAnalysis)
          }
        }]
      };
      console.log('Using mock formatted data');
    } else {
      const client = getClient();
      if (!client) {
        // Fallback to mock
        const mockAnalysis = generateMockAnalysis(buffer, file.originalFilename);
        llm = {
          choices: [{
            message: {
              content: JSON.stringify(mockAnalysis)
            }
          }]
        };
        console.log('Using mock formatted data (no API key)');
      } else {
        try {
          console.log('Calling LLM for formatting...');
          llm = await client.chat.completions.create({
            model: MODEL,
            messages: [
              { 
                role: 'system', 
                content: 'You are an expert AI assistant that extracts maximum information from images. You MUST return ONLY valid JSON without any markdown formatting, code blocks, or extra text. The response must be parseable JSON.' 
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
          const mockAnalysis = generateMockAnalysis(buffer, file.originalFilename);
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
      console.error('Error extracting LLM text:', e);
      llmText = JSON.stringify(llm);
    }

    // Parse and validate JSON
    let parsed = {};
    try {
      // Clean JSON string
      let cleanText = llmText.trim();
      
      // Remove markdown code blocks
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/```\n?/g, '').trim();
      }
      
      // Remove any leading/trailing whitespace or newlines
      cleanText = cleanText.trim();
      
      parsed = JSON.parse(cleanText);
      
      // Validate and ensure all required fields exist with defaults
      if (!parsed.imageSummary || typeof parsed.imageSummary !== 'string') {
        parsed.imageSummary = caption || 'Image analysis completed';
      }
      
      if (!parsed.detectedElements || !Array.isArray(parsed.detectedElements)) {
        parsed.detectedElements = [];
      }
      
      if (!parsed.detailedExplanation || typeof parsed.detailedExplanation !== 'string') {
        parsed.detailedExplanation = outputText.slice(0, 800) || 'Detailed analysis available';
      }
      
      if (!parsed.realWorldApplications || typeof parsed.realWorldApplications !== 'string') {
        parsed.realWorldApplications = 'Analysis available - see detailed explanation';
      }
      
      if (!parsed.educationalInsight || typeof parsed.educationalInsight !== 'string') {
        parsed.educationalInsight = 'See detailed explanation above for learning insights';
      }
      
      if (!parsed.confidenceLevel || !['High', 'Medium', 'Low'].includes(parsed.confidenceLevel)) {
        parsed.confidenceLevel = 'Medium';
      }
      
      if (!parsed.domain || typeof parsed.domain !== 'string') {
        parsed.domain = 'Unknown';
      }
      
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
      
      // Optional fields with defaults
      if (!parsed.colors || typeof parsed.colors !== 'string') {
        parsed.colors = 'Not specified';
      }
      
      if (!parsed.environment || typeof parsed.environment !== 'string') {
        parsed.environment = 'Not specified';
      }
      
      if (!parsed.people || typeof parsed.people !== 'string') {
        parsed.people = 'No people detected';
      }
      
      if (!parsed.technicalDetails || typeof parsed.technicalDetails !== 'string') {
        parsed.technicalDetails = 'Not specified';
      }
      
    } catch (e) {
      console.error('JSON parsing error:', e);
      console.error('Raw LLM text (first 500 chars):', llmText.substring(0, 500));
      
      // Comprehensive fallback
      parsed = {
        imageSummary: caption || 'Image analysis completed',
        detectedElements: [],
        detailedExplanation: outputText.slice(0, 1000) || llmText.slice(0, 1000) || 'Analysis completed',
        realWorldApplications: 'See detailed explanation for applications',
        educationalInsight: 'See detailed explanation for educational value',
        confidenceLevel: 'Medium',
        domain: 'Unknown',
        extractedText: '',
        colors: 'Not specified',
        environment: 'Not specified',
        people: 'No people detected',
        technicalDetails: 'Not specified'
      };
    }

    // Prepare comprehensive final result
    const finalResult = {
      id,
      caption,
      rawVision: outputText,
      ...parsed,
      related,
      filename: file.originalFilename || 'upload',
      fileSize: buffer.length,
      timestamp: new Date().toISOString(),
      imageDataUrl: dataUrl, // Include the processed image data URL
      isMockData: useMock, // Flag to indicate if this is mock data
      // Image properties
      imageProperties: {
  ...imageMetadata,
  aspectRatio:
    originalDimensions.width > 0 && originalDimensions.height > 0
      ? (originalDimensions.width / originalDimensions.height).toFixed(2)
      : '0:0',
  megapixels:
    originalDimensions.width > 0 && originalDimensions.height > 0
      ? ((originalDimensions.width * originalDimensions.height) / 1000000).toFixed(2)
      : '0'
},

      imageDataUrl: dataUrl, // Include the processed image data URL
      isMockData: useMock // Flag to indicate if this is mock data
    };

    // Save to database
    try {
      const savedAnalysis = saveAnalysis({
        ...finalResult,
        filename: file.originalFilename || 'upload',
        embedding
      });
      finalResult.dbId = savedAnalysis.id;
      finalResult.savedAt = savedAnalysis.timestamp;
    } catch (dbError) {
      console.error('Database save error:', dbError);
      // Continue even if database save fails
    }

    console.log('Analysis complete, returning result');
    res.status(200).json(finalResult);

  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ 
      error: 'Analysis failed', 
      detail: err.message || String(err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
