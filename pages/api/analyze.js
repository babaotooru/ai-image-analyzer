import OpenAI from "openai";
import sharp from "sharp";
import { hashBuffer } from "../../lib/hashImage";
import { addEntry, findSimilar } from "../../lib/vectorStore";
import { saveAnalysis } from "../../lib/database";

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" }
  }
};

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const EMB_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const MAX_SIMILAR = Number(process.env.MAX_SIMILAR || 3);
const USE_MOCK_DATA =
  process.env.USE_MOCK_DATA === "true" || !process.env.OPENAI_API_KEY;

/* -------------------- helpers -------------------- */

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function generateMockAnalysis() {
  return {
    imageSummary: "Mock image analysis",
    detectedElements: ["Sample object"],
    detailedExplanation:
      "This is mock data. Set OPENAI_API_KEY to get real analysis.",
    realWorldApplications: "Demo purpose",
    educationalInsight: "Learning mock pipeline",
    confidenceLevel: "Medium",
    domain: "General",
    extractedText: "",
    colors: "Not specified",
    environment: "Unknown",
    people: "No people detected",
    technicalDetails: "Mock mode",
    related: []
  };
}

/* -------------------- handler -------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { imageBase64, filename } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "No image provided" });
    }

    /* ---------- base64 → buffer ---------- */
    const base64Data = imageBase64.split(",")[1];
    const buffer = Buffer.from(base64Data, "base64");

    /* ---------- image processing ---------- */
    const resized = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: "inside" })
      .jpeg({ quality: 85 })
      .toBuffer();

    const id = await hashBuffer(resized);
    const dataUrl = `data:image/jpeg;base64,${resized.toString("base64")}`;

    /* ---------- vision analysis ---------- */
    let outputText = "";
    let useMock = USE_MOCK_DATA;

    if (useMock) {
      outputText = generateMockAnalysis().detailedExplanation;
    } else {
      try {
        const client = getClient();
        const vision = await client.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this image in detail." },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            }
          ],
          max_tokens: 1200
        });

        outputText = vision.choices[0].message.content;
      } catch (err) {
        console.error("Vision error:", err);
        outputText = generateMockAnalysis().detailedExplanation;
        useMock = true;
      }
    }

    /* ---------- embedding ---------- */
    let embedding = [];
    if (!useMock) {
      try {
        const client = getClient();
        const emb = await client.embeddings.create({
          model: EMB_MODEL,
          input: outputText.slice(0, 1000)
        });
        embedding = emb.data[0].embedding;
      } catch {
        embedding = [];
      }
    }

    /* ---------- vector store ---------- */
    try {
      addEntry({
        id,
        summary: outputText.slice(0, 200),
        embedding,
        ts: Date.now(),
        meta: { filename }
      });
    } catch {}

    let related = [];
    try {
      related = embedding.length
        ? findSimilar(embedding, MAX_SIMILAR)
        : [];
    } catch {}

    /* ---------- FINAL RESULT ---------- */
    const finalResult = {
      id,
      filename: filename || "upload",
      analysis: outputText,
      related,
      imageDataUrl: dataUrl,
      isMockData: useMock,
      timestamp: new Date().toISOString()
    };

    try {
      saveAnalysis({ ...finalResult, embedding });
    } catch {}

    return res.status(200).json(finalResult);
  } catch (err) {
    console.error("Analyze error:", err);
    return res.status(500).json({
      error: "Analysis failed",
      detail: err.message
    });
  }
}
