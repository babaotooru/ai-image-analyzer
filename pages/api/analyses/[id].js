import { getAnalysisById, deleteAnalysis } from '../../../lib/database';

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Analysis ID is required' });
  }

  if (req.method === 'GET') {
    try {
      const analysis = getAnalysisById(id);
      if (!analysis) {
        return res.status(404).json({ error: 'Analysis not found' });
      }
      return res.status(200).json(analysis);
    } catch (error) {
      console.error('Error fetching analysis:', error);
      return res.status(500).json({ error: 'Failed to fetch analysis', detail: error.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const deleted = deleteAnalysis(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Analysis not found' });
      }
      return res.status(200).json({ success: true, message: 'Analysis deleted' });
    } catch (error) {
      console.error('Error deleting analysis:', error);
      return res.status(500).json({ error: 'Failed to delete analysis', detail: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}



