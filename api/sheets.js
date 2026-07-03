const { google } = require('googleapis');

const SHEET_ID = '17mW4c5Iv5BnmFDW1RE-ckaqjQ6IHLC5Hapb6kgCmBE8';
const SHEET_NAME = '재고';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// ══════════════════════════════════════════
// 시트 컬럼: A:고유번호 B:제품명 C:위치 D:수량 E:상태
//            F:이미지URL G:등록일 H:최종수정 I:비고 J:블로그링크
// ══════════════════════════════════════════

async function getProduct(id) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
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
        note: rows[i][8] || '',
        blogUrl: rows[i][9] || '',
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
    range: `${SHEET_NAME}!A:J`,
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
        data.note || '',
        data.blogUrl || '',
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
    range: `${SHEET_NAME}!A${rowIndex}:J${rowIndex}`,
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
        data.note || '',
        data.blogUrl || '',
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
    range: `${SHEET_NAME}!A:J`,
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
    note: row[8] || '',
    blogUrl: row[9] || '',
    rowIndex: i + 2,
  })).filter(p => p.id);
}

async function uploadImage(base64Data, filename, mimeType) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary 환경변수가 설정되지 않았습니다');
  }

  const timestamp = Math.round(Date.now() / 1000);
  const crypto = require('crypto');
  const signature = crypto.createHash('sha1').update(`timestamp=${timestamp}${apiSecret}`).digest('hex');
  const dataUri = `data:${mimeType || 'image/jpeg'};base64,${base64Data}`;
  const params = new URLSearchParams();
  params.append('file', dataUri);
  params.append('timestamp', timestamp.toString());
  params.append('api_key', apiKey);
  params.append('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: params,
  });

  const result = await response.json();
  if (result.error) throw new Error(`Cloudinary 오류: ${result.error.message}`);
  if (!result.secure_url) throw new Error('이미지 URL을 받을 수 없습니다');
  return result.secure_url;
}

// ══════════════════════════════════════════
// 네이버 블로그 대표 이미지(og:image) 추출
// ══════════════════════════════════════════

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://blog.naver.com/',
};

function extractBlogIdAndLogNo(blogUrl) {
  // 지원 형식:
  // https://blog.naver.com/{blogId}/{logNo}
  // https://m.blog.naver.com/{blogId}/{logNo}
  // https://blog.naver.com/PostView.naver?blogId={blogId}&logNo={logNo}
  let match = blogUrl.match(/blog\.naver\.com\/([^\/\?]+)\/(\d+)/);
  if (match) return { blogId: match[1], logNo: match[2] };

  const u = new URL(blogUrl);
  const blogId = u.searchParams.get('blogId');
  const logNo = u.searchParams.get('logNo');
  if (blogId && logNo) return { blogId, logNo };

  return null;
}

function extractOgImage(html) {
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!m) return null;
  return m[1].replace(/&amp;/g, '&');
}

async function fetchNaverBlogImage(blogUrl) {
  const parsed = extractBlogIdAndLogNo(blogUrl);
  if (!parsed) {
    throw new Error('올바른 네이버 블로그 게시글 주소가 아닙니다 (예: blog.naver.com/아이디/글번호)');
  }
  const { blogId, logNo } = parsed;

  // 1차 시도: 모바일 버전 (iframe 없이 바로 본문 로드됨)
  const mobileUrl = `https://m.blog.naver.com/${blogId}/${logNo}`;
  let html = null;
  let lastError = null;

  try {
    const resp = await fetch(mobileUrl, { headers: BROWSER_HEADERS });
    if (resp.ok) html = await resp.text();
    else lastError = new Error(`모바일 블로그 접속 실패 (HTTP ${resp.status})`);
  } catch (e) {
    lastError = e;
  }

  // 2차 시도: PC 버전 iframe 내부 실제 콘텐츠 주소
  if (!html) {
    try {
      const iframeUrl = `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`;
      const resp2 = await fetch(iframeUrl, { headers: BROWSER_HEADERS });
      if (resp2.ok) html = await resp2.text();
      else lastError = new Error(`블로그 접속 실패 (HTTP ${resp2.status})`);
    } catch (e2) {
      lastError = e2;
    }
  }

  if (!html) {
    throw new Error(`네이버 블로그에 접속할 수 없습니다: ${lastError ? lastError.message : '알 수 없는 오류'}`);
  }

  const ogImage = extractOgImage(html);
  if (!ogImage) {
    throw new Error('이 게시글에서 대표 이미지를 찾을 수 없습니다');
  }
  return ogImage;
}

async function downloadImageAsBase64(imageUrl) {
  const resp = await fetch(imageUrl, {
    headers: {
      'User-Agent': BROWSER_HEADERS['User-Agent'],
      'Referer': 'https://blog.naver.com/',
    },
  });
  if (!resp.ok) throw new Error(`이미지 다운로드 실패 (HTTP ${resp.status})`);
  const contentType = resp.headers.get('content-type') || 'image/jpeg';
  const buffer = await resp.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return { base64, mimeType: contentType.split(';')[0] };
}

async function fetchBlogImageAndUpload(blogUrl, filename) {
  const naverImageUrl = await fetchNaverBlogImage(blogUrl);
  const { base64, mimeType } = await downloadImageAsBase64(naverImageUrl);
  const imageUrl = await uploadImage(base64, filename, mimeType);
  return { imageUrl, sourceImageUrl: naverImageUrl };
}

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
      await addProduct(req.body);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && action === 'update') {
      const status = await updateProduct(req.body.rowIndex, req.body);
      return res.status(200).json({ success: true, status });
    }

    if (req.method === 'POST' && action === 'upload') {
      const { base64, filename, mimeType } = req.body;
      const imageUrl = await uploadImage(base64, filename, mimeType);
      return res.status(200).json({ success: true, imageUrl });
    }

    if (req.method === 'POST' && action === 'fetchBlogImage') {
      const { blogUrl, filename } = req.body;
      if (!blogUrl) return res.status(400).json({ error: '블로그 주소가 필요합니다' });
      const { imageUrl, sourceImageUrl } = await fetchBlogImageAndUpload(
        blogUrl,
        filename || `blog_${Date.now()}.jpg`
      );
      return res.status(200).json({ success: true, imageUrl, sourceImageUrl });
    }

    if (req.method === 'GET' && action === 'debug') {
      return res.status(200).json({
        CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ? `있음(길이:${process.env.CLOUDINARY_CLOUD_NAME.length})` : '없음',
        CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ? `있음(길이:${process.env.CLOUDINARY_API_KEY.length})` : '없음',
        CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ? `있음(길이:${process.env.CLOUDINARY_API_SECRET.length})` : '없음',
        GOOGLE_CREDENTIALS: process.env.GOOGLE_CREDENTIALS ? '있음' : '없음',
      });
    }

    return res.status(400).json({ error: '알 수 없는 요청' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };
