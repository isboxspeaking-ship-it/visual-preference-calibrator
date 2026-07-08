const MAX_REPORT_LENGTH = 90000;

module.exports = async function handler(req, res) {
  const allowedOrigins = new Set([
    'https://yingjia-ai-visual-calibration.vercel.app',
    'https://isboxspeaking-ship-it.github.io'
  ]);
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: '仅支持提交结果' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const customerName = String(body?.customerName || '').trim().slice(0, 40);
    if (!customerName) return res.status(400).json({ ok: false, message: '请填写客户姓名' });

    const requiredEnv = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BASE_TOKEN', 'FEISHU_TABLE_ID'];
    const missing = requiredEnv.filter(key => !process.env[key]);
    if (missing.length) throw new Error('提交服务尚未完成配置');

    const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || tokenData.code !== 0 || !tokenData.tenant_access_token) {
      throw new Error('飞书授权失败');
    }

    const directions = Array.isArray(body.directions) ? body.directions : [];
    const rate = dir => (directions.find(item => item.dir === dir)?.rate || 0) / 100;
    const fields = {
      '客户姓名': customerName,
      '项目名称': String(body.projectName || '该项目').slice(0, 80),
      '提交时间': Number(body.submittedAt) || Date.now(),
      '优先方向': String(body.winner || '').slice(0, 120),
      '方向A喜欢率': rate('A'),
      '方向B喜欢率': rate('B'),
      '方向C喜欢率': rate('C'),
      '喜欢数量': Number(body.likes) || 0,
      '待定数量': Number(body.maybes) || 0,
      '排除数量': Number(body.nos) || 0,
      '偏好要素': (body.topTraits || []).join('、').slice(0, 2000),
      '整体偏好': (body.overallPreference || []).join('；').slice(0, 5000),
      '明确雷区': (body.dangers || []).join('、').slice(0, 2000),
      'D3设计指令': String(body.instruction || '').slice(0, 10000),
      '完整报告': String(body.report || '').slice(0, MAX_REPORT_LENGTH),
      '提交编号': String(body.submissionId || '').slice(0, 80)
    };

    const recordResponse = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_BASE_TOKEN}/tables/${process.env.FEISHU_TABLE_ID}/records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.tenant_access_token}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ fields })
      }
    );
    const recordData = await recordResponse.json();
    if (!recordResponse.ok || recordData.code !== 0) {
      console.error('Feishu record creation failed', recordData.code, recordData.msg);
      throw new Error('结果写入飞书失败');
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, recordId: recordData.data?.record?.record_id || '' });
  } catch (error) {
    console.error('Submit error', error.message);
    return res.status(500).json({ ok: false, message: error.message || '提交失败，请稍后重试' });
  }
};
