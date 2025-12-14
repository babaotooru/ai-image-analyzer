import { getAllAnalyses, getAnalysisById, searchAnalyses, getStats } from '../../lib/database';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const { id, search, limit, offset, stats } = req.query;

      // Get statistics
      if (stats === 'true') {
        const statistics = getStats();
        return res.status(200).json(statistics);
      }

      // Get single analysis by ID
      if (id) {
        const analysis = getAnalysisById(id);
        if (!analysis) {
          return res.status(404).json({ error: 'Analysis not found' });
        }
        return res.status(200).json(analysis);
      }

      // Search analyses
      if (search) {
        const results = searchAnalyses(search);
        return res.status(200).json({ results, count: results.length });
      }

      // Get all analyses with pagination
      const analyses = getAllAnalyses(
        limit ? parseInt(limit, 10) : null,
        offset ? parseInt(offset, 10) : 0
      );

      return res.status(200).json({
        analyses,
        count: analyses.length,
        total: getAllAnalyses().length
      });
    } catch (error) {
      console.error('Error fetching analyses:', error);
      return res.status(500).json({ error: 'Failed to fetch analyses', detail: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}



