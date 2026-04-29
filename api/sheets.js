const { google } = require('googleapis');

const SHEET_ID = '17mW4c5Iv5BnmFDW1RE-ckaqjQ6IHLC5Hapb6kgCmBE8';
const SHEET_NAME = '재고';
const DRIVE_FOLDER_ID = '14S8D_Iq5LtvDV6RjzKN2RsjV9rzv8jVB';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

// 시트에서 제품 조회
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

// 시트에 제품 추가
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

// 시트에서 제품 수정
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

// 전체 제품 목록 조회
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

// 이미지 업로드 to 구글 드라이브
async function uploadImage(base64Data, filename, mimeType) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const buffer = Buffer.from(base64Data, 'base64');
  const { Readable } = require('stream');
  const stream = Readable.from(buffer);
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [DRIVE_FOLDER_ID],
    },
    supportsAllDrives: true,
    media: {
      mimeType: mimeType || 'image/jpeg',
      body: stream,
    },
    fields: 'id,webViewLink,webContentLink',
  });
  // 공개 접근 권한 부여
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });
  const imageUrl = `https://lh3.googleusercontent.com/d/${res.data.id}`;
  return imageUrl;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action } = req.query;

    // 제품 조회
    if (req.method === 'GET' && action === 'get') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id 필요' });
      const product = await getProduct(id);
      return res.status(200).json({ product });
    }

    // 전체 목록 조회
    if (req.method === 'GET' && action === 'list') {
      const products = await getAllProducts();
      return res.status(200).json({ products });
    }

    // 제품 등록
    if (req.method === 'POST' && action === 'add') {
      const data = req.body;
      await addProduct(data);
      return res.status(200).json({ success: true });
    }

    // 제품 수정 (수량 등)
    if (req.method === 'POST' && action === 'update') {
      const data = req.body;
      const status = await updateProduct(data.rowIndex, data);
      return res.status(200).json({ success: true, status });
    }

    // 이미지 업로드
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
