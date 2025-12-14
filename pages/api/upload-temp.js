import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const config = { api: { bodyParser: false } };

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new formidable.IncomingForm({ multiples: false });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST' });
  const { files } = await parseForm(req);
  const file = files.image;
  if (!file) return res.status(400).json({ error: 'No image' });

  const uploadsDir = path.join(process.cwd(), 'tmp_uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

  const id = uuidv4();
  const dest = path.join(uploadsDir, id + path.extname(file.originalFilename || file.filepath || ''));

  fs.copyFileSync(file.filepath || file.path, dest);

  res.status(200).json({ ok: true, id, path: dest });
}
