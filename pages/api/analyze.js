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

/* ----------------------- Helpers ----------------------- */

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
    imageSummary:
      "This is a mock image analysis generated because no API key is configured.",
    detectedElements: ["Sample object", "Background element"],
    detailedExplanation:
      "Mock mode is active. Configure OPENAI_API_KEY for real analysis.",
    realWorldApplications: "Demonstration and testing",
    educationalInsight: "Shows the structure of AI analysis output",
    confidenceLevel: "Medium",
    domain: "General",
    extractedText: "",
    colors: "Various",
    environment: "Unknown",
    people: "No people detected",
    technicalDetails: "Mock data"
  };
}

/* ----------------------- API ----------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    /* ---------- Parse upload ---------- */
    const { files } = await parseForm(req);
    const file = files?.image;

    if (!file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const buffer = fs.readFileSync(file.filepath || file.path);

    /* ---------- Image processing ---------- */
    const resized = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: "inside" })
      .jpeg({ quality: 90 })
      .toBuffer();

    const id = await hashBuffer(resized);
    const dataUrl = `data:image/jpeg;base64,${resized.toString("base64")}`;

    /* ---------- Vision Analysis ---------- */
    let visionText = "";
    let useMock = USE_MOCK_DATA;

    if (useMock) {
      const mock = generateMockAnalysis();
      visionText = mock.detailedExplanation;
    } else {
      const client = getClient();
      if (!client) {
        useMock = true;
        const mock = generateMockAnalysis();
        visionText = mock.detailedExplanation;
      } else {
        const response = await client.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Analyze this image in detail." },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            }
          ],
          max_tokens: 2000
        });

        visionText = response.choices[0].message.content;
      }
    }

    /* ---------- Embedding ---------- */
    let embedding = [];
    const client = getClient();

    if (!useMock && client) {
      const emb = await client.embeddings.create({
        model: EMB_MODEL,
        input: visionText.slice(0, 1000)
      });
      embedding = emb.data[0].embedding;
    } else {
      embedding = new Array(1536).fill(0);
    }

    /* ---------- Vector Store ---------- */
    addEntry({
      id,
      summary: visionText.slice(0, 500),
      embedding,
      ts: Date.now(),
      meta: { filename: file.originalFilename || "upload" }
    });

    const related = !useMock ? findSimilar(embedding, MAX_SIMILAR) : [];

    /* ---------- Final Result ---------- */
    const finalResult = {
      id,
      caption: visionText.slice(0, 120),
      rawVision: visionText,
      imageSummary: visionText.slice(0, 300),
      detectedElements: [],
      detailedExplanation: visionText,
      realWorldApplications: "See detailed explanation",
      educationalInsight: "Extract knowledge from visual context",
      confidenceLevel: useMock ? "Medium" : "High",
      domain: "General",
      extractedText: "",
      colors: "Not specified",
      environment: "Not specified",
      people: "Not detected",
      technicalDetails: "Image resized and analyzed",
      related,
      filename: file.originalFilename || "upload",
      fileSize: buffer.length,
      timestamp: new Date().toISOString(),
      imageDataUrl: dataUrl,
      isMockData: useMock
    };

    /* ---------- Save ---------- */
    try {
      const saved = saveAnalysis({ ...finalResult, embedding });
      finalResult.dbId = saved?.id;
    } catch (e) {
      console.error("DB save failed:", e);
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
