const { google } = require('googleapis');

const SHEET_ID = '17mW4c5Iv5BnmFDW1RE-ckaqjQ6IHLC5Hapb6kgCmBE8';
const SHEET_NAME = '재고';

// Vercel 본문 크기 제한 늘리기 (이미지 업로드용)
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getProduct(id) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:H`,
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      return {
        id: rows[i][0] || '',
        name: rows[i][1] || '',
        location: rows[i][2] || '',
        quantity: parseInt(rows[i][3]) || 0,
        status: rows[i][4] || '미등록',
        imageUrl: rows[i][5] || '',
        createdAt: rows[i][6] || '',
        updatedAt: rows[i][7] || '',
        rowIndex: i + 1,
      };
    }
  }
  return null;
}

async function addProduct(data) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        data.id,
        data.name,
        data.location,
        data.quantity,
        data.quantity > 0 ? '정상' : '품절',
        data.imageUrl || '',
        now,
        now,
      ]],
    },
  });
}

async function updateProduct(rowIndex, data) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const status = data.quantity > 0 ? '정상' : '품절';
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${rowIndex}:H${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        data.id,
        data.name,
        data.location,
        data.quantity,
        status,
        data.imageUrl || '',
        data.createdAt,
        now,
      ]],
    },
  });
  return status;
}

async function getAllProducts() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:H`,
  });
  const rows = res.data.values || [];
  if (rows.length <= 1) return [];
  return rows.slice(1).map((row, i) => ({
    id: row[0] || '',
    name: row[1] || '',
    location: row[2] || '',
    quantity: parseInt(row[3]) || 0,
    status: row[4] || '',
    imageUrl: row[5] || '',
    createdAt: row[6] || '',
    updatedAt: row[7] || '',
    rowIndex: i + 2,
  })).filter(p => p.id);
}

// Cloudinary 이미지 업로드
async function uploadImage(base64Data, filename, mimeType) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary 환경변수가 설정되지 않았습니다');
  }

  const timestamp = Math.round(Date.now() / 1000);
  const crypto = require('crypto');
  
  // Cloudinary는 SHA-1 사용
  const signature = crypto
    .createHash('sha1')
    .update(`timestamp=${timestamp}${apiSecret}`)
    .digest('hex');

  const dataUri = `data:${mimeType || 'image/jpeg'};base64,${base64Data}`;

  // form-urlencoded 방식으로 전송
  const params = new URLSearchParams();
  params.append('file', dataUri);
  params.append('timestamp', timestamp.toString());
  params.append('api_key', apiKey);
  params.append('signature', signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: 'POST',
      body: params,
    }
  );

  const result = await response.json();
  
  if (result.error) {
    throw new Error(`Cloudinary 오류: ${result.error.message}`);
  }
  
  if (!result.secure_url) {
    throw new Error('이미지 URL을 받을 수 없습니다');
  }

  return result.secure_url;
}

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action } = req.query;

    if (req.method === 'GET' && action === 'get') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id 필요' });
      const product = await getProduct(id);
      return res.status(200).json({ product });
    }

    if (req.method === 'GET' && action === 'list') {
      const products = await getAllProducts();
      return res.status(200).json({ products });
    }

    if (req.method === 'POST' && action === 'add') {
      const data = req.body;
      await addProduct(data);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && action === 'update') {
      const data = req.body;
      const status = await updateProduct(data.rowIndex, data);
      return res.status(200).json({ success: true, status });
    }

    if (req.method === 'POST' && action === 'upload') {
      const { base64, filename, mimeType } = req.body;
      const imageUrl = await uploadImage(base64, filename, mimeType);
      return res.status(200).json({ success: true, imageUrl });
    }

    return res.status(400).json({ error: '알 수 없는 요청' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
