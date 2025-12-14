import formidable from "formidable";
import fs from "fs";
import OpenAI from "openai";
import sharp from "sharp";
import { hashBuffer } from "../../lib/hashImage";
import { addEntry, findSimilar } from "../../lib/vectorStore";
import { saveAnalysis } from "../../lib/database";

export const config = { api: { bodyParser: false } };

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const EMB_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const MAX_SIMILAR = parseInt(process.env.MAX_SIMILAR || "3", 10);
const USE_MOCK_DATA =
  process.env.USE_MOCK_DATA === "true" || !process.env.OPENAI_API_KEY;

/* -------------------- Helpers -------------------- */

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
    imageSummary: "Mock image analysis (no API key configured).",
    detectedElements: ["Sample object"],
    detailedExplanation: "Mock mode active.",
    realWorldApplications: "Demo usage",
    educationalInsight: "Structure demonstration",
    confidenceLevel: "Medium",
    domain: "General",
    extractedText: "",
    colors: "Unknown",
    environment: "Unknown",
    people: "No people detected",
    technicalDetails: "Mock data"
  };
}

/* -------------------- API -------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
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

    /* ---------- Vision ---------- */
    let outputText = "";
    let useMock = USE_MOCK_DATA;

    if (useMock) {
      outputText = generateMockAnalysis().detailedExplanation;
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
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0.1
        });

        outputText = response.choices[0].message.content || "";
      }
    }

    const caption =
      outputText.split("\n")[0]?.slice(0, 150) || "Image analysis";

    /* ---------- Embedding ---------- */
    let embedding = [];
    const summary = `${caption} -- ${outputText.slice(0, 500)}`;

    if (!useMock) {
      const client = getClient();
      if (client) {
        const emb = await client.embeddings.create({
          model: EMB_MODEL,
          input: summary
        });
        embedding = emb.data[0].embedding;
      }
    } else {
      embedding = new Array(1536).fill(0);
    }

    /* ---------- Vector store ---------- */
    addEntry({
      id,
      summary,
      embedding,
      ts: Date.now(),
      meta: { filename: file.originalFilename || "upload" }
    });

    const related = !useMock ? findSimilar(embedding, MAX_SIMILAR) : [];

    /* ---------- Final result ---------- */
    const finalResult = {
      id,
      caption,
      rawVision: outputText,
      imageSummary: caption,
      detailedExplanation: outputText,
      confidenceLevel: useMock ? "Medium" : "High",
      domain: "General",
      related,
      filename: file.originalFilename || "upload",
      fileSize: buffer.length,
      timestamp: new Date().toISOString(),

      // preview + flags
      imageDataUrl: dataUrl,
      isMockData: useMock
    };

    /* ---------- Save ---------- */
    try {
      const saved = saveAnalysis({ ...finalResult, embedding });
      finalResult.dbId = saved?.id;
    } catch (e) {
      console.error("DB save error:", e);
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
