import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'analyses-db.json');

// Initialize database if it doesn't exist
function initDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initialData = {
      analyses: [],
      metadata: {
        createdAt: new Date().toISOString(),
        totalAnalyses: 0
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
  }
}

// Read database
function readDB() {
  initDB();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw || '{"analyses":[],"metadata":{"totalAnalyses":0}}');
  } catch (e) {
    console.error('Error reading database:', e);
    return { analyses: [], metadata: { totalAnalyses: 0 } };
  }
}

// Write database
function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Error writing database:', e);
    return false;
  }
}

// Save analysis to database
export function saveAnalysis(analysisData) {
  const db = readDB();
  const analysis = {
    id: analysisData.id || `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    imageHash: analysisData.id,
    filename: analysisData.filename || 'unknown',
    imageSummary: analysisData.imageSummary || '',
    detectedElements: analysisData.detectedElements || [],
    detailedExplanation: analysisData.detailedExplanation || '',
    realWorldApplications: analysisData.realWorldApplications || '',
    educationalInsight: analysisData.educationalInsight || '',
    confidenceLevel: analysisData.confidenceLevel || 'Medium',
    domain: analysisData.domain || 'Unknown',
    extractedText: analysisData.extractedText || '',
    caption: analysisData.caption || '',
    rawVision: analysisData.rawVision || '',
    related: analysisData.related || [],
    embedding: analysisData.embedding || null,
    metadata: analysisData.metadata || {}
  };

  // Check if analysis with same hash already exists
  const existingIndex = db.analyses.findIndex(a => a.imageHash === analysis.imageHash);
  if (existingIndex >= 0) {
    // Update existing
    db.analyses[existingIndex] = { ...db.analyses[existingIndex], ...analysis };
  } else {
    // Add new
    db.analyses.push(analysis);
    db.metadata.totalAnalyses = db.analyses.length;
  }

  writeDB(db);
  return analysis;
}

// Get analysis by ID
export function getAnalysisById(id) {
  const db = readDB();
  return db.analyses.find(a => a.id === id || a.imageHash === id);
}

// Get analysis by hash
export function getAnalysisByHash(hash) {
  const db = readDB();
  return db.analyses.find(a => a.imageHash === hash);
}

// Get all analyses
export function getAllAnalyses(limit = null, offset = 0) {
  const db = readDB();
  const analyses = db.analyses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  if (limit) {
    return analyses.slice(offset, offset + limit);
  }
  return analyses;
}

// Search analyses
export function searchAnalyses(query) {
  const db = readDB();
  const lowerQuery = query.toLowerCase();
  
  return db.analyses.filter(analysis => {
    return (
      analysis.imageSummary?.toLowerCase().includes(lowerQuery) ||
      analysis.detailedExplanation?.toLowerCase().includes(lowerQuery) ||
      analysis.domain?.toLowerCase().includes(lowerQuery) ||
      analysis.extractedText?.toLowerCase().includes(lowerQuery) ||
      analysis.detectedElements?.some(el => el.toLowerCase().includes(lowerQuery)) ||
      analysis.filename?.toLowerCase().includes(lowerQuery)
    );
  });
}

// Delete analysis
export function deleteAnalysis(id) {
  const db = readDB();
  const initialLength = db.analyses.length;
  db.analyses = db.analyses.filter(a => a.id !== id && a.imageHash !== id);
  db.metadata.totalAnalyses = db.analyses.length;
  writeDB(db);
  return initialLength > db.analyses.length;
}

// Get statistics
export function getStats() {
  const db = readDB();
  const stats = {
    totalAnalyses: db.analyses.length,
    domains: {},
    confidenceLevels: {},
    recentAnalyses: db.analyses
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10)
      .map(a => ({
        id: a.id,
        timestamp: a.timestamp,
        domain: a.domain,
        imageSummary: a.imageSummary?.substring(0, 100) + '...'
      }))
  };

  db.analyses.forEach(analysis => {
    // Count domains
    const domain = analysis.domain || 'Unknown';
    stats.domains[domain] = (stats.domains[domain] || 0) + 1;

    // Count confidence levels
    const conf = analysis.confidenceLevel || 'Medium';
    stats.confidenceLevels[conf] = (stats.confidenceLevels[conf] || 0) + 1;
  });

  return stats;
}

// Initialize on import
initDB();



