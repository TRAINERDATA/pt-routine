/* PT 루틴 기록 저장소
   구글 시트 → 확장 프로그램 → Apps Script 에 이 파일 내용을 그대로 붙여넣고 웹 앱으로 배포하세요.
   (자세한 순서는 README의 "구글 시트 자동 저장" 참고)

   시트 탭은 처음 저장될 때 자동으로 생겨요.
   - 기록: 회원·날짜별 한 줄. 트레이너가 보는 탭
   - 회원: 이름, 1RM, 사이클
   - 원본: 앱이 기록을 복원할 때 쓰는 데이터 (수정하지 마세요) */

const LOG_HEAD = ['이름', '날짜', '운동', '완료 세트', '종목별 기록', '칼로리', '단백질(g)', '체중', '걸음 수', '수면', '컨디션', '통증', '식단', '마지막 저장'];
const MEM_HEAD = ['이름', 'PIN 확인값', '벤치 1RM', '데드 1RM', '스쿼트 1RM', 'OHP 1RM', '사이클', '가입', '마지막 저장'];
const RAW_HEAD = ['이름', '키', '데이터', '저장 시각'];
const KEY_RE = /^pt-(log-\d{4}-\d{2}-\d{2}|cycle|profile)$/;

function doPost(e) {
  let out;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    out = handle(JSON.parse(e.postData.contents));
  } catch (err) {
    out = {ok: false, error: String((err && err.message) || err)};
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('PT 루틴 기록 저장소가 동작 중이에요');
}

function handle(req) {
  if (req.action === 'save') return save(req);
  if (req.action === 'load') return load(req);
  return {ok: false, error: '알 수 없는 요청'};
}

function sheet(name, head) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.setFrozenRows(1);
  }
  return sh;
}

function now() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

function pinHash(name, pin) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'pt-routine|' + name + '|' + pin));
}

/* finds the member row; registers a new member when create is true */
function auth(req, create) {
  const name = String(req.name || '').trim();
  const pin = String(req.pin || '');
  if (!name || !/^\d{4,8}$/.test(pin)) return {error: '이름과 숫자 PIN(4~8자리)이 필요해요'};
  const sh = sheet('회원', MEM_HEAD);
  const rows = sh.getDataRange().getValues();
  const h = pinHash(name, pin);
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][0]) === name) return rows[r][1] === h ? {row: r + 1, name: name} : {error: 'PIN이 맞지 않아요'};
  }
  if (!create) return {error: '그 이름으로 저장된 기록이 없어요'};
  sh.appendRow([name, h, '', '', '', '', '', now(), now()]);
  return {row: sh.getLastRow(), name: name};
}

function save(req) {
  const a = auth(req, true);
  if (a.error) return {ok: false, error: a.error};
  const t = now();
  const raw = sheet('원본', RAW_HEAD);
  const rawIdx = {};
  raw.getDataRange().getValues().forEach((r, i) => { if (i && String(r[0]) === a.name) rawIdx[r[1]] = i + 1; });
  const logs = sheet('기록', LOG_HEAD);
  const logIdx = {};
  logs.getDataRange().getValues().forEach((r, i) => { if (i && String(r[0]) === a.name) logIdx[String(r[1]).replace(/^'/, '')] = i + 1; });
  const mem = sheet('회원', MEM_HEAD);
  let saved = 0;
  (req.items || []).forEach(it => {
    const key = String(it.key || '');
    if (!KEY_RE.test(key)) return;
    const json = JSON.stringify(it.value);
    if (rawIdx[key]) raw.getRange(rawIdx[key], 3, 1, 2).setValues([[json, t]]);
    else { raw.appendRow([a.name, key, json, t]); rawIdx[key] = raw.getLastRow(); }
    if (key.indexOf('pt-log-') === 0 && Array.isArray(it.row)) {
      const date = key.slice(7);
      const cells = it.row.slice(0, LOG_HEAD.length - 3);
      while (cells.length < LOG_HEAD.length - 3) cells.push('');
      const row = [a.name, "'" + date].concat(cells, [t]);
      if (logIdx[date]) logs.getRange(logIdx[date], 1, 1, row.length).setValues([row]);
      else { logs.appendRow(row); logIdx[date] = logs.getLastRow(); }
    }
    if (key === 'pt-profile' && it.value) {
      const rm = it.value.rm || {};
      mem.getRange(a.row, 3, 1, 4).setValues([[rm.bench || '', rm.dead || '', rm.squat || '', rm.ohp || '']]);
    }
    if (key === 'pt-cycle' && it.value) mem.getRange(a.row, 7).setValue((it.value.n || 0) + 1);
    saved++;
  });
  mem.getRange(a.row, 9).setValue(t);
  return {ok: true, saved: saved, at: t};
}

function load(req) {
  const a = auth(req, false);
  if (a.error) return {ok: false, error: a.error};
  const data = {};
  sheet('원본', RAW_HEAD).getDataRange().getValues().forEach((r, i) => {
    if (i && String(r[0]) === a.name) { try { data[r[1]] = JSON.parse(r[2]); } catch (e) {} }
  });
  return {ok: true, data: data};
}
