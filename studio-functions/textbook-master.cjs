'use strict';

const HEADERS = Object.freeze(['原文ID','科目','単元ID','Part','文番号','教科書本文（英語）','日本語訳','重要文法・語句メモ','生成対象','備考']);
const TAB = '教科書本文マスター';
const READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const clean = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
class MasterError extends Error {
 constructor(status,message) { super(message); this.status=status; }
}
const fail = (status, message) => new MasterError(status,message);
const partKey = value => clean(value).replace(/^part\s*/i, '').trim();

function validateSelection(input) {
 const { subject, lesson, part } = input || {};
 if (!['英C','論表'].includes(subject) || typeof lesson !== 'string' || typeof part !== 'string' ||
     !clean(lesson) || !partKey(part) || lesson.length > 80 || part.length > 30 || /[<>]/.test(lesson + part)) {
  throw fail(400,'科目・Lesson・Partを確認してください');
 }
 return { subject, lesson: clean(lesson), part: partKey(part) };
}

function assertHeaders(values) {
 if (!Array.isArray(values) || !Array.isArray(values[0]) || values[0].length !== HEADERS.length ||
     values[0].some((header,index) => header !== HEADERS[index])) {
  throw fail(422,'教科書本文マスターの列名と順序を確認してください');
 }
}

function assembleTextbookMaster(values, selection) {
 assertHeaders(values);
 const ids = new Set(), numbers = new Set(), matches = [];
 for (let index = 1; index < values.length; index++) {
  const row = values[index];
  if (!Array.isArray(row)) throw fail(422,'教科書本文マスターの行形式が不正です');
  if (clean(row[1]) !== selection.subject || clean(row[2]) !== selection.lesson || partKey(row[3]) !== selection.part) continue;
  const id = clean(row[0]), numberText = clean(row[4]), number = Number(numberText), english = clean(row[5]);
  if (!id || id.length > 100 || !/^\d+$/.test(numberText) || !Number.isSafeInteger(number) || number < 1 || !english) {
   throw fail(422,'対象の原文ID・文番号・英文を確認してください');
  }
  if (ids.has(id) || numbers.has(number)) throw fail(422,'対象の原文IDまたは文番号が重複しています');
  ids.add(id);
  numbers.add(number);
  matches.push({ number, english });
  if (matches.length > 150) throw fail(422,'対象の英文は150行以内にしてください');
 }
 if (!matches.length) throw fail(404,'指定した科目・Lesson・Partの本文が見つかりません');
 matches.sort((a,b) => a.number - b.number);
 const source = matches.map(row => row.english).join('\n');
 if (source.length > 20000) throw fail(422,'対象の英文は合計2万文字以内にしてください');
 return { source, sentenceCount: matches.length };
}

async function sheetValues(response) {
 const chunks = [];
 let size = 0;
 for await (const chunk of response.body) {
  const bytes = Buffer.from(chunk);
  size += bytes.length;
  if (size > MAX_RESPONSE_BYTES) throw fail(422,'教科書本文マスターの読み取りサイズが上限を超えました');
  chunks.push(bytes);
 }
 return JSON.parse(Buffer.concat(chunks).toString('utf8')).values;
}

async function fetchMasterValues({ config, getRuntimeToken, fetcher = fetch }, headerOnly = false) {
 const spreadsheetId = config.STUDIO_MASTER_SPREADSHEET_ID;
 const reader = config.STUDIO_MASTER_READER_SERVICE_ACCOUNT;
 if (!/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId || '') ||
     !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(reader || '')) {
  throw fail(503,'本文マスターの読み取り設定が未確認です。管理者にご確認ください');
 }
 const signal = AbortSignal.timeout(15000);
 let values;
 try {
  const runtimeToken = await getRuntimeToken();
  if (typeof runtimeToken !== 'string' || !runtimeToken) throw fail(502,'本文マスターの読み取り認証を確認できません');
  const credentials = await fetcher(
   'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + encodeURIComponent(reader) + ':generateAccessToken',
   { method:'POST', headers:{ Authorization:'Bearer ' + runtimeToken, 'Content-Type':'application/json' },
    body:JSON.stringify({ scope:[READ_SCOPE], lifetime:'300s' }), signal, redirect:'error' });
  if (!credentials.ok) throw fail(502,'本文マスターの読み取り認証を確認できません');
  const { accessToken } = await credentials.json();
  if (typeof accessToken !== 'string' || !accessToken) throw fail(502,'本文マスターの読み取り認証を確認できません');
  const range = encodeURIComponent("'" + TAB + "'" + (headerOnly ? "!1:1" : ""));
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + '/values/' + range +
   '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE';
  const response = await fetcher(url, { method:'GET', headers:{ Authorization:'Bearer ' + accessToken },
   signal, redirect:'error' });
  if ([401,403,404].includes(response.status)) throw fail(502,'本文マスターのシート名または閲覧権限を確認してください');
  if (!response.ok) throw fail(502,'教科書本文マスターを読み取れませんでした');
  values = await sheetValues(response);
 } catch (error) {
  if (error instanceof MasterError) throw error;
  throw fail(502,'教科書本文マスターの読み取りに失敗しました');
 }
 return values;
}

async function readTextbookMaster(input, options) {
 const selection = validateSelection(input);
 return assembleTextbookMaster(await fetchMasterValues(options), selection);
}

async function checkTextbookMasterHeader(options) {
 assertHeaders(await fetchMasterValues(options, true));
}

module.exports = { HEADERS, assembleTextbookMaster, checkTextbookMasterHeader, readTextbookMaster, validateSelection };
