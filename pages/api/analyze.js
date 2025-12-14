import formidable from "formidable";
import fs from "fs";
import OpenAI from "openai";
import sharp from "sharp";
import { hashBuffer } from "../../lib/hashImage";
import { addEntry, findSimilar } from "../../lib/vectorStore";
import { saveAnalysis } from "../../lib/database";

export const config = {
  api: { bodyParser: false }
};

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const EMB_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const MAX_SIMILAR = parseInt(process.env.MAX_SIMILAR || "3", 10);
const USE_MOCK_DATA =
  process.env.USE_MOCK_DATA === "true" || !process.env.OPENAI_API_KEY;

/* -------------------- UTILITIES -------------------- */

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch {
    return null;
  }
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new formidable.IncomingForm();
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function generateMockAnalysis() {
  return {
    imageSummary: "Mock image analysis (API key not configured).",
    detectedElements: ["Sample object"],
    detailedExplanation:
      "This is mock data. Configure OPENAI_API_KEY to enable real analysis.",
    realWorldApplications: "Demonstration purpose",
    educationalInsight: "Shows system output structure",
    confidenceLevel: "Medium",
    domain: "General",
    extractedText: "",
    colors: "Unknown",
    environment: "Unknown",
    people: "No people detected",
    technicalDetails: "Mock mode"
  };
}

/* -------------------- API HANDLER -------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { files } = await parseForm(req);
    const file = files.image;

    if (!file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const buffer = fs.readFileSync(file.filepath || file.path);
    if (!buffer?.length) {
      return res.status(400).json({ error: "Invalid image file" });
    }

    /* ---------- IMAGE PROCESSING ---------- */

    const resized = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: "inside" })
      .jpeg({ quality: 90 })
      .toBuffer();

    const id = await hashBuffer(resized);
    const dataUrl = `data:image/jpeg;base64,${resized.toString("base64")}`;

    /* ---------- VISION ANALYSIS ---------- */

    let outputText = "";
    let useMock = USE_MOCK_DATA;

    if (useMock) {
      const mock = generateMockAnalysis();
      outputText = mock.detailedExplanation;
    } else {
      const client = getClient();
      if (!client) {
        useMock = true;
        outputText = generateMockAnalysis().detailedExplanation;
      } else {
        const response = await client.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Analyze this image in detail." },
                {
                  type: "image_url",
                  image_url: { url: dataUrl, detail: "high" }
                }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0.2
        });

        outputText =
          response.choices?.[0]?.message?.content ||
          "No analysis returned.";
      }
    }

    /* ---------- EMBEDDING ---------- */

    let embedding = [];
    const client = getClient();

    if (client && !useMock) {
      const emb = await client.embeddings.create({
        model: EMB_MODEL,
        input: outputText.slice(0, 1000)
      });
      embedding = emb.data[0].embedding;
    } else {
      embedding = new Array(1536).fill(0);
    }

    addEntry({
      id,
      summary: outputText.slice(0, 200),
      embedding,
      ts: Date.now()
    });

    const related = embedding.length
      ? findSimilar(embedding, MAX_SIMILAR)
      : [];

    /* ---------- FINAL RESPONSE (FIXED) ---------- */

    const finalResult = {
      id,
      caption: outputText.slice(0, 120),
      rawVision: outputText,
      related,
      filename: file.originalFilename || "upload",
      fileSize: buffer.length,
      timestamp: new Date().toISOString(),

      imageDataUrl: dataUrl,
      isMockData: useMock,

      imageProperties: {
        sizeMB: (buffer.length / (1024 * 1024)).toFixed(2)
      }
    };

    try {
      const saved = saveAnalysis({ ...finalResult, embedding });
      finalResult.dbId = saved?.id;
    } catch {
      // DB failure should not block response
    }

    return res.status(200).json(finalResult);
  } catch (err) {
    console.error("Analyze error:", err);
    return res.status(500).json({
      error: "Analysis failed",
      detail: err.message
    });
  }
}
