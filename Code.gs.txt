/* PT 루틴 기록 저장소
   구글 시트 → 확장 프로그램 → Apps Script 에 이 파일 내용을 그대로 붙여넣고 웹 앱으로 배포하세요.
   (자세한 순서는 README의 "구글 시트 자동 저장" 참고)

   시트 탭은 처음 저장될 때 자동으로 생겨요.
   - 기록: 회원·날짜별 한 줄. 트레이너가 보는 탭
   - 회원: 이름, 1RM, 사이클
   - 원본: 앱이 기록을 복원할 때 쓰는 데이터 (수정하지 마세요)
   - 코칭: 주말에 Claude가 써준 회원별 코칭을 붙여넣는 곳. 회원 앱에 자동으로 떠요
   - Claude 요약: 메뉴 "PT 루틴 → 이번 주 Claude용 요약 만들기"를 누르면 생겨요 */

const LOG_HEAD = ['이름', '날짜', '운동', '완료 세트', '종목별 기록', '칼로리', '단백질(g)', '체중', '걸음 수', '수면', '컨디션', '통증', '식단', '마지막 저장'];
const MEM_HEAD = ['이름', 'PIN 확인값', '벤치 1RM', '데드 1RM', '스쿼트 1RM', 'OHP 1RM', '사이클', '가입', '마지막 저장'];
const RAW_HEAD = ['이름', '키', '데이터', '저장 시각'];
const COACH_HEAD = ['이름', '주 시작일', '한줄 코멘트', '잘한 점', '고칠 점', '다음 주 목표', '무게 지정', '종목 교체', '1RM 갱신'];
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
  if (req.action === 'coach') return coach(req);
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

/* latest coaching row for this member (by 주 시작일) */
function coach(req) {
  const a = auth(req, false);
  if (a.error) return {ok: false, error: a.error};
  let best = null;
  sheet('코칭', COACH_HEAD).getDataRange().getValues().forEach((r, i) => {
    if (!i || String(r[0]).trim() !== a.name) return;
    const week = r[1] instanceof Date ? Utilities.formatDate(r[1], 'Asia/Seoul', 'yyyy-MM-dd') : String(r[1]).replace(/^'/, '').trim();
    if (!best || week >= best.week) best = {week: week, comment: r[2], good: r[3], fix: r[4], goal: r[5], weights: r[6], swaps: r[7], rm: r[8]};
  });
  return {ok: true, coach: best};
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PT 루틴').addItem('이번 주 Claude용 요약 만들기', 'weeklyPrompt').addToUi();
  sheet('코칭', COACH_HEAD);
}

/* builds one cell with instructions + the last 7 days of every member, ready to paste into Claude */
function weeklyPrompt() {
  const tz = 'Asia/Seoul', fmt = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const today = new Date(), from = new Date(today.getTime() - 6 * 864e5);
  const next = new Date(today.getTime());
  do { next.setTime(next.getTime() + 864e5); } while (Utilities.formatDate(next, tz, 'u') !== '1');
  const lo = fmt(from), hi = fmt(today), week = fmt(next);
  const mem = sheet('회원', MEM_HEAD).getDataRange().getValues().slice(1);
  const logs = sheet('기록', LOG_HEAD).getDataRange().getValues().slice(1).map(r => {
    r = r.slice(); r[1] = r[1] instanceof Date ? fmt(r[1]) : String(r[1]).replace(/^'/, ''); return r;
  }).filter(r => r[1] >= lo && r[1] <= hi).sort((x, y) => String(x[0]).localeCompare(String(y[0])) || x[1].localeCompare(y[1]));
  const lines = [];
  mem.forEach(m => {
    const mine = logs.filter(r => String(r[0]) === String(m[0]));
    lines.push('### ' + m[0] + ' (1RM 벤치 ' + (m[2] || '?') + ' / 데드 ' + (m[3] || '?') + ' / 스쿼트 ' + (m[4] || '?') + ' / OHP ' + (m[5] || '?') + ', 사이클 ' + (m[6] || 1) + ')');
    if (!mine.length) lines.push('- 이번 주 기록 없음');
    mine.forEach(r => lines.push('- ' + LOG_HEAD.slice(1, 13).map((h, j) => r[j + 1] === '' ? '' : h + ': ' + r[j + 1]).filter(Boolean).join(' | ')));
    lines.push('');
  });
  const text = [
    '너는 우리 팀 PT 트레이너야. 아래는 회원들의 지난 7일(' + lo + ' ~ ' + hi + ') 운동·식단 기록이야.',
    '종목별 기록은 "종목명 무게x횟수 N세트" 형식이고, 루틴은 가슴→등→어깨→하체 순환, 반복 범위 상단을 RIR 2로 채우면 증량하는 방식이야.',
    '',
    '회원마다 다음 주 코칭을 써줘. 결과는 구글 시트에 그대로 붙여넣을 거라서 형식을 꼭 지켜줘:',
    '- 코드 블록 하나 안에, 회원 한 명당 한 줄, 칸은 탭(TAB)으로 구분. 머리글 줄은 쓰지 마',
    '- 칸 순서: 이름 / 주 시작일 / 한줄 코멘트 / 잘한 점 / 고칠 점 / 다음 주 목표 / 무게 지정 / 종목 교체 / 1RM 갱신',
    '- 이름: 아래 ### 뒤 이름 그대로. 주 시작일: ' + week,
    '- 한줄 코멘트·잘한 점·고칠 점·다음 주 목표: 짧은 한국어 문장. 칸 안에 탭이나 줄바꿈 금지 (여러 개면 " / "로 구분)',
    '- 무게 지정: 다음 주에 바로 쓸 무게를 "종목명=무게x횟수"로, 여러 개면 "; "로 구분. 예) 바벨 벤치프레스=80x5; 컨벤셔널 데드리프트=130x4. 종목명은 기록에 나온 이름 그대로. 맨몸이면 "맨몸x12". 바꿀 게 없으면 빈칸',
    '- 종목 교체: 통증이나 정체 때문에 바꿔야 할 때만 "원래 종목>새 종목", 여러 개면 "; ". 예) 덤벨 플라이 (깊게)>케이블 플라이 (낮은 곳→위). 없으면 빈칸',
    '- 1RM 갱신: 기록상 확실히 늘었을 때만 "벤치 105, 데드 155, 스쿼트 150, OHP 62"처럼. 없으면 빈칸',
    '- 기록이 없는 회원도 한 줄 써줘 (복귀 독려 코멘트, 나머지는 빈칸)',
    '- 통증·어지러움 같은 위험 신호가 있으면 고칠 점에 무게를 낮추거나 쉬라고 분명히 써줘',
    '',
    '코드 블록 다음에 트레이너인 나에게 팀 전체 요약을 3줄 이내로 따로 알려줘.',
    '',
    '## 회원 기록',
    lines.join('\n')
  ].join('\n');
  const sh = sheet('Claude 요약', ['아래 A2 칸을 복사해서 Claude에게 붙여넣으세요. 답으로 받은 코드 블록 내용은 "코칭" 탭 첫 빈 줄의 A칸에 붙여넣으면 회원 앱에 떠요']);
  sh.getRange(2, 1).setValue(text);
  SpreadsheetApp.getActive().setActiveSheet(sh);
  try { SpreadsheetApp.getUi().alert('"Claude 요약" 탭의 A2 칸을 복사해서 Claude에게 붙여넣으세요. (회원 ' + mem.length + '명, ' + logs.length + '일치 기록)'); } catch (e) {}
  return text;
}
