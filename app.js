function nums(str){const k=str.match(/([\d,]+)kcal/);const p=str.match(/단백질\s*(\d+)g/);return [k?+k[1].replace(/,/g,''):0,p?+p[1]:0]}
function totals(lg){let k=0,p=0;MEALS.forEach(m=>{if(!m.id)return;const j=(lg.meals||{})[m.id];if(j!==undefined&&m.o[j]){const n=nums(m.o[j][2]);k+=n[0];p+=n[1]}});return [k,p]}
function workoutKey(lg){const ks=Object.keys(DAYS).filter(k=>lg[k]&&Object.values(lg[k]).some(st=>(st.sets||[]).some(Boolean)||st.kg||st.memo));return ks.length?ks:[]}
function buildLog(date,lg){
  const info=lg.info||{}; const [k,p]=totals(lg);
  const wk=[...new Set([...workoutKey(lg),...Object.keys(lg.done||{}).filter(k=>lg.done[k]&&DAYS[k])])];
  const wlines=wk.length?wk.map(key=>{const d=DAYS[key];return `${d.name}\n`+d.ex.map((e,i)=>{const st=(lg[key]&&lg[key][i])||{sets:[],kg:''};const n=(st.sets||[]).filter(Boolean).length;return n||st.kg||st.memo?`  ${st.n||e.n}: ${st.kg||'?'} / ${n}세트${st.memo?' / 메모: '+st.memo:''}`:null}).filter(Boolean).join('\n')}).join('\n'):(lg.cardio?`유산소로 대체 (${lg.cardio.t} ${lg.cardio.min||'?'}분)`:lg.pass?'패스 (휴식)':'기록 없음');
  const meal=MEALS.filter(m=>m.id).map(m=>{const j=(lg.meals||{})[m.id];const memo=(lg.memo||{})[m.id];const pick=j!==undefined&&m.o[j]?`${m.o[j][0]}: ${m.o[j][1]}`:'선택 안 함';return `  ${m.t.replace(/^[①②③]\s*/,'')}: ${pick}${memo?' / '+memo:''}`}).join('\n');
  const extra=wk.length&&lg.cardio?`\n  + 유산소 ${lg.cardio.t} ${lg.cardio.min||'?'}분`:'';
  const etc=MEALS.some(m=>m.id&&(lg.meals||{})[m.id]!==undefined&&m.o[(lg.meals||{})[m.id]]&&m.o[(lg.meals||{})[m.id]][0]==='기타 (메모대로)');
  return `[오늘 기록]\n- 날짜: ${date}\n- 체중(아침 공복): ${info.w||''}\n- 운동: ${wlines}${extra}\n  체감 RIR:\n- 식단 (버튼 기준 약 ${k.toLocaleString()}kcal · 단백질 ${p}g${etc?', 기타 끼니는 메모로 따로 계산':''})\n${meal}\n- 걸음 수: ${info.steps||''}\n- 수면 시간: ${info.sleep||''}\n- 컨디션(1~10) / 통증 여부: ${info.cond||''} / ${info.pain||''}`;
}

const PLATE = {CH:'--p-red',BK:'--p-blue',SH:'--p-yellow',LG:'--p-green'};
const ORDER = ['CH','BK','SH','LG'];
const WEEKDAY = ['일','월','화','수','목','금','토'];
const XP_LV = 600;
const CARDIO = ['수영','러닝','사이클','인클라인 걷기','기타'];

function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
const now = new Date(); const today = ymd(now);
/* A/B week: main lifts fixed, accessories alternate weekly. Week of 2026-10-12 = A */
const store = {
  get(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch(e){return f}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}markPending(k)}
};
/* ---------- Google Sheet sync ----------
   every change to a log, the cycle or the profile is queued in pt-pending and posted to the
   Apps Script web app (SYNC_URL in routine.js). Name + PIN identify the member on the sheet. */
const SYNC_RE=/^pt-(log-\d{4}-\d{2}-\d{2}|cycle|profile)$/;
let syncUnverified=false,syncState='',syncErr='',syncT=null,syncBusy=false,syncAgain=false;
function syncOn(){return !!(SYNC_URL&&PROF&&PROF.name&&PROF.pin)}
function markPending(k){if(!SYNC_URL||!SYNC_RE.test(k))return;const p=store.get('pt-pending',{});p[k]=Date.now();
  try{localStorage.setItem('pt-pending',JSON.stringify(p))}catch(e){}if(syncOn()&&syncState!=='auth')syncState='busy';queueSync()}
function markAllPending(){try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&SYNC_RE.test(k))markPending(k)}}catch(e){}}
function queueSync(ms){if(!syncOn()||syncState==='auth')return;clearTimeout(syncT);syncT=setTimeout(flushSync,ms==null?1500:ms)}
function syncCheck(j){if(!j||!j.ok)throw Object.assign(new Error((j&&j.error)||'저장 실패'),{auth:/PIN|이름/.test((j&&j.error)||'')});return j}
async function syncPost(body){
  try{const r=await fetch(SYNC_URL,{method:'POST',body:JSON.stringify(body),credentials:'omit'});return syncCheck(await r.json())}
  catch(e){if(e.auth)throw e;return syncFallback(body)}}
/* Safari and in-app browsers sometimes can't read the answer, which arrives through a redirect.
   Then: saves go as a fire-and-forget POST and are confirmed with a JSONP check; reads go over JSONP */
async function syncFallback(body){
  if(body.action==='save'){await fetch(SYNC_URL,{method:'POST',mode:'no-cors',body:JSON.stringify(body),credentials:'omit'});
    try{return syncCheck(await jsonp({action:'check',name:body.name,pin:body.pin}))}catch(e){if(e.auth)throw e;return {ok:true,unverified:true}}}
  return syncCheck(await jsonp(body))}
let jsonpN=0;
function jsonp(body){return new Promise((ok,bad)=>{const cb='__ptcb'+(++jsonpN)+'_'+Date.now(),sc=document.createElement('script');
  const done=()=>{clearTimeout(t);delete window[cb];sc.remove()},t=setTimeout(()=>{done();bad(new Error('응답 없음'))},15000);
  window[cb]=j=>{done();ok(j)};sc.onerror=()=>{done();bad(new Error('연결 실패'))};
  /* the script ran but never called back: the deployed Apps Script predates JSONP support */
  sc.onload=()=>setTimeout(()=>{if(window[cb]){done();bad(new Error('시트 코드가 예전 버전이에요'))}},50);
  sc.src=SYNC_URL+'?cb='+cb+'&p='+encodeURIComponent(JSON.stringify(body));document.head.appendChild(sc)})}
/* one readable row for the trainer's sheet; the full log goes along as JSON for restoring */
function sheetRow(lg){
  const parts=[],det=[];let sets=0;
  Object.keys(BASE).forEach(k=>Object.entries(lg[k]||{}).forEach(([i,st])=>{const n=(st.sets||[]).filter(Boolean).length;sets+=n;
    if(n||st.kg||st.memo)det.push(`${st.n||(BASE[k].ex[i]||{}).n} ${st.kg||'?'} ${n}세트${st.memo?' ('+st.memo+')':''}`)}));
  const dk=doneKeys(lg);if(dk.length)parts.push(dk.map(x=>DAYS[x].name).join('+'));else if(workoutKey(lg).length)parts.push(workoutKey(lg).map(x=>DAYS[x].name+' 진행').join('+'));
  if(lg.cardio)parts.push(`유산소 ${lg.cardio.t} ${lg.cardio.min||'?'}분`);if(lg.pass&&!parts.length)parts.push('휴식');
  const [kc,pr]=totals(lg),info=lg.info||{};
  const meal=MEALS.filter(m=>m.id).map(m=>{const j=(lg.meals||{})[m.id],memo=(lg.memo||{})[m.id];const pick=j!=null&&m.o[j]?m.o[j][0]:'';return pick||memo?`${m.t.replace(/^[①②③]\s*/,'').split(' ')[0]}: ${pick}${memo?' / '+memo:''}`:''}).filter(Boolean).join(' · ');
  return [parts.join(' + '),sets||'',det.join(', '),kc||'',pr||'',info.w||'',info.steps||'',info.sleep||'',info.cond||'',info.pain||'',meal]}
async function flushSync(){
  if(!syncOn())return;if(syncBusy){syncAgain=true;return}
  const pend=store.get('pt-pending',{}),keys=Object.keys(pend);if(!keys.length){syncState='ok';renderHeader();return}
  syncBusy=true;syncState='busy';renderHeader();
  const batch=keys.slice(0,30),items=[];
  batch.forEach(k=>{let v=store.get(k,null);if(v==null)return;
    if(k==='pt-profile'){v=Object.assign({},v);delete v.pin}
    const it={key:k,value:v};if(k.startsWith('pt-log-')){if(!Object.keys(v).length)return;it.row=sheetRow(v)}items.push(it)});
  try{const res=items.length?await syncPost({action:'save',name:PROF.name,pin:PROF.pin,items}):{};syncUnverified=!!res.unverified;
    const cur=store.get('pt-pending',{});batch.forEach(k=>{if(cur[k]===pend[k])delete cur[k]});
    try{localStorage.setItem('pt-pending',JSON.stringify(cur))}catch(e){}
    syncState=Object.keys(cur).length?'busy':'ok';syncErr='';syncBusy=false;
    if(Object.keys(cur).length||syncAgain){syncAgain=false;queueSync(200)}}
  catch(e){syncBusy=false;syncErr=e.message||String(e);syncState=e.auth?'auth':'wait';if(!e.auth)queueSync(30000)}
  renderHeader();paintClearSync()}
window.addEventListener('online',()=>queueSync(0));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){queueSync(0);fetchCoach()}});
/* profile: name, 1RM per main lift, daily targets. Lives only in this browser */
const LIFTS=[['bench','벤치프레스'],['dead','데드리프트'],['squat','스쿼트'],['ohp','오버헤드프레스']];
let PROF=store.get('pt-profile',null);
/* weekly coaching the trainer pastes into the sheet's 코칭 tab (cached so it works offline) */
let COACH=parseCoach(store.get('pt-coach',null));
function parseCoach(c){if(!c||!c.week)return null;const L=s=>String(s||'').split(/\s*[;\n]\s*/).map(x=>x.trim()).filter(Boolean);
  const w={};L(c.weights).forEach(x=>{const m=x.match(/^(.+?)\s*=\s*(.+)$/);if(!m)return;const v=parseKg(m[2])||bodyKg(m[2]);if(v)w[m[1].trim()]=v});
  const sw={};L(c.swaps).forEach(x=>{const m=x.match(/^(.+?)\s*>\s*(.+)$/);if(m)sw[m[1].trim()]=m[2].trim()});
  const rm={},K={'벤치':'bench','데드':'dead','스쿼트':'squat','ohp':'ohp'};String(c.rm||'').replace(/(벤치|데드|스쿼트|ohp)[^\d]*(\d+(?:\.\d+)?)/gi,(_,a,b)=>{rm[K[a.toLowerCase()]]=+b});
  return Object.assign({},c,{w,sw,rmv:rm})}
async function fetchCoach(){if(!syncOn())return;
  try{const j=await syncPost({action:'coach',name:PROF.name,pin:PROF.pin});const c=j.coach||null;
    if(JSON.stringify(c)===JSON.stringify(store.get('pt-coach',null)))return;
    store.set('pt-coach',c);COACH=parseCoach(c);
    /* 1RM update from the trainer: apply once per coaching week, then weights are recomputed on reload */
    if(COACH&&Object.keys(COACH.rmv).length&&store.get('pt-coach-rm','')!==COACH.week){store.set('pt-coach-rm',COACH.week);
      PROF=Object.assign({},PROF,{rm:Object.assign({},PROF.rm,COACH.rmv)});store.set('pt-profile',PROF);toast('트레이너가 1RM을 갱신했어요');setTimeout(()=>location.reload(),900);return}
    applyCycle();render(true);if(COACH)toast('이번 주 코칭이 도착했어요')}catch(e){}}
function prof(){return PROF||{name:'',rm:{},kcal:DEFAULT_TARGETS.kcal,prot:DEFAULT_TARGETS.prot}}
function rnd(v,step){return Math.max(step,Math.round(v/step)*step)}
function kgOf(w){const base=+((prof().rm||{})[w[0]]||0);if(!base)return '1RM 입력 필요';return w[2]==='db'?`한 손 ${rnd(base*w[1],2)}kg`:`${rnd(base*w[1],2.5)}kg`}
/* pristine team routine; the per-cycle version is rebuilt from this by applyCycle() */
const BASE={};Object.entries(DAYS).forEach(([k,d])=>BASE[k]={tag:d.tag,ex:d.ex.map(e=>Object.assign({},e))});
/* warm-up ramp from each person's working weight on the main lift */
const MAIN_PCT={bench:.75,dead:.82,squat:.8,ohp:.75};
Object.values(WU).forEach(L=>L.forEach(w=>{if(typeof w[1]!=='object')return;const {lift,name}=w[1],base=+((prof().rm||{})[lift]||0);
  if(!base){w[1]=`${name} 빈 바 10회 → 작업 무게 50% 5회 → 70% 3회 (설정에서 1RM 입력하면 무게가 나와요)`;return}
  const top=base*MAIN_PCT[lift],r=v=>rnd(v,2.5);
  w[1]=`${name} ${lift==='dead'?r(top*.5)+'kg':'빈 바'} 10회 → ${r(top*.5)}kg 5회 → ${r(top*.7)}kg 3회${lift==='dead'||lift==='squat'?` → ${r(top*.85)}kg 1회`:''}`}));
const logKey = 'pt-log-'+today;
let log = store.get(logKey,{});
function save(){store.set(logKey,log)}
/* rotation: first day in ORDER not yet done this cycle. */
/* cycle.n counts finished rounds; each new round swaps a few accessories (see applyCycle) */
let cycle = store.get('pt-cycle',null) || {done:[],n:0};
cycle.done = cycle.done.filter(k=>ORDER.includes(k));cycle.n=cycle.n||0;
function saveCycle(){store.set('pt-cycle',cycle)}
function nextDay(){return ORDER.find(k=>!cycle.done.includes(k))||ORDER[0]}
/* returns true when this finished a full round */
function markDone(keys){log.cn=log.cn||{};keys.forEach(k=>{if(log.cn[k]==null)log.cn[k]=cycle.n;if(!cycle.done.includes(k))cycle.done.push(k)});save();
  let wrapped=false;if(ORDER.every(k=>cycle.done.includes(k))){cycle.done=[];cycle.n++;wrapped=true}saveCycle();if(wrapped)applyCycle();return wrapped}
/* round a day was trained in: today's log pins it so finishing a round doesn't relabel today's exercises */
function cnFor(k){return log.cn&&log.cn[k]!=null?log.cn[k]:cycle.n}
/* round 0 = the team routine as written. From round 1 on, each day swaps SWAPS_PER_CYCLE accessories,
   always starting from the original: least-recently-swapped slots go first, and each slot walks through its v list */
const planMemo={};
function plan(k,n){const id=k+n;if(planMemo[id])return planMemo[id];
  const ex=BASE[k].ex,slots=ex.map((e,i)=>i).filter(i=>ex[i].v&&ex[i].v.length&&!ex[i].off);
  const last={},times={};let picks={};
  for(let c=1;c<=n;c++){let seed=(c*7919+k.charCodeAt(0)*131+k.charCodeAt(1))%2147483647;const rand=()=>(seed=seed*16807%2147483647)/2147483647;
    const order=slots.map(i=>({i,r:rand()})).sort((a,b)=>(last[a.i]||0)-(last[b.i]||0)||a.r-b.r).slice(0,SWAPS_PER_CYCLE);
    picks={};order.forEach(({i})=>{times[i]=(times[i]||0)+1;last[i]=c;picks[i]=(times[i]-1)%ex[i].v.length})}
  return planMemo[id]=picks}
function applyCycle(){Object.keys(BASE).forEach(k=>{const n=cnFor(k),picks=plan(k,n);
  DAYS[k].tag=BASE[k].tag+' · CYCLE '+(n+1);
  DAYS[k].ex=BASE[k].ex.map((e,i)=>{let o;if(picks[i]!=null){const v=e.v[picks[i]];o=Object.assign({},e,v,{alt:e.n,isNew:1});if(!v.g)delete o.g;if(!v.w)delete o.w;if(v.w)delete o.kg}else o=Object.assign({},e);
    delete o.v;
    const to=COACH&&COACH.sw[o.n];if(to){const d=findEx(to);o=Object.assign({},o,{n:to,alt:o.n,coach:1,isNew:0});delete o.g;delete o.w;o.kg='무게 직접 설정';
      if(d){if(d.w)o.w=d.w;else if(d.kg)o.kg=d.kg;if(d.r)o.r=d.r;if(d.g)o.g=d.g}}
    if(o.w)o.kg=kgOf(o.w);return o})})}
/* an exercise definition anywhere in the routine (main list or variant pools), by name */
function findEx(name){for(const k in BASE)for(const e of BASE[k].ex){if(e.n===name)return e;for(const v of e.v||[])if(v.n===name)return v}return null}
applyCycle();
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function col(k){return `var(${PLATE[k]||'--p-gray'})`}
function md(d){return d.slice(5).replace('-','/')}
function lgOf(d){return d===today?log:store.get('pt-log-'+d,{})}

/* ---------- xp / level ---------- */
function setsDone(lg,k,i){return ((lg[k]&&lg[k][i]&&lg[k][i].sets)||[]).filter(Boolean).length}
function doneKeys(lg){return Object.keys(lg.done||{}).filter(k=>lg.done[k]&&DAYS[k])}
function xpOf(lg){
  let x=0;
  Object.keys(DAYS).forEach(k=>{if(!lg[k])return;DAYS[k].ex.forEach((e,i)=>{const n=setsDone(lg,k,i);x+=Math.min(n,e.s)*10;if(n>=e.s)x+=20})});
  x+=doneKeys(lg).length*200; if(lg.cardio)x+=100;
  Object.values(lg.meals||{}).forEach(v=>{if(v!==undefined&&v!==null)x+=30});
  const info=lg.info||{}; if(info.w)x+=20; if(+info.steps>=8000)x+=50;
  return x;
}
function allDates(){const out=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('pt-log-'))out.push(k.slice(7))}}catch(e){}if(!out.includes(today))out.push(today);return out.sort().reverse()}
function totalXP(){return allDates().reduce((a,d)=>a+xpOf(lgOf(d)),0)}
function lvOf(x){return Math.floor(x/XP_LV)+1}
function active(lg){return doneKeys(lg).length>0||!!lg.cardio}
function monday(){const m=new Date(now);m.setDate(now.getDate()-((now.getDay()+6)%7));return m}
function weekCount(){const m=monday();let n=0;for(let i=0;i<7;i++){const d=new Date(m);d.setDate(m.getDate()+i);if(active(lgOf(ymd(d))))n++}return n}

/* ---------- shared ---------- */
let view = ({'#train':'train','#food':'food','#log':'log','#set':'set'})[location.hash]||'home';
let session = [ (doneKeys(log)[0]) || nextDay() ];   // 1 or 2 day keys
let comboMode = false, homeMode = '';
let toastT;
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.hidden=false;t.style.animation='none';t.offsetHeight;t.style.animation='';clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,1500)}
function restSec(s){const m=String(s).match(/(\d+)(?:~(\d+))?\s*(분|초)/);if(!m)return 90;const a=+m[1],b=m[2]?+m[2]:a;const v=(a+b)/2;return Math.round(m[3]==='분'?v*60:v)}
/* iOS-style wheel picker sheet */
const W_LIST=[...Array.from({length:41},(_,i)=>i),...Array.from({length:104},(_,i)=>42.5+i*2.5)];
const R_LIST=Array.from({length:30},(_,i)=>i+1);
const IH=44;
function wheelCol(list,val,fmt){const idx=Math.max(0,list.findIndex(x=>x>=val));return {html:`<div class="wcol"><div class="wscroll">${list.map(x=>`<div class="wi">${fmt(x)}</div>`).join('')}</div></div>`,idx:idx<0?list.length-1:idx}}
function openWheel(name,w,r,done){
  const sh=document.getElementById('sheet');
  const cw=wheelCol(W_LIST,w,x=>x?x+'<small>kg</small>':'맨몸'),cr=wheelCol(R_LIST,r,x=>x+'<small>회</small>');
  sh.innerHTML=`<div class="sbg"></div><div class="spanel" role="dialog" aria-label="무게와 횟수"><div class="shd"><button type="button" class="sx">취소</button><span>${esc(name)}</span><button type="button" class="sok">완료</button></div><div class="wheels"><div class="wband"></div>${cw.html}${cr.html}</div></div>`;
  sh.hidden=false;
  const cols=[...sh.querySelectorAll('.wscroll')],lists=[W_LIST,R_LIST],sel=[cw.idx,cr.idx];
  cols.forEach((c,n)=>{c.scrollTop=sel[n]*IH;const mark=()=>{const j=Math.min(lists[n].length-1,Math.max(0,Math.round(c.scrollTop/IH)));sel[n]=j;c.querySelectorAll('.wi').forEach((el,q)=>el.classList.toggle('on',q===j))};mark();let t;c.addEventListener('scroll',()=>{clearTimeout(t);t=setTimeout(mark,60);mark()},{passive:true});
    c.querySelectorAll('.wi').forEach((el,q)=>el.onclick=()=>c.scrollTo({top:q*IH,behavior:'smooth'}))});
  const close=()=>{sh.hidden=true;sh.innerHTML=''};
  sh.querySelector('.sbg').onclick=close;sh.querySelector('.sx').onclick=close;
  sh.querySelector('.sok').onclick=()=>{done(W_LIST[sel[0]],R_LIST[sel[1]]);close()};
}
function wr(k,i,e,st,L){const own=parseKg(st&&st.kg)||bodyKg(st&&st.kg);if(own)return own;const rc=recommend(k,i,e);if(rc)return [rc.w,rc.r];const w=String(e.kg).match(/(\d+(?:\.\d+)?)/);const r=String(e.r).match(/(\d+)/);return [w?+w[1]:0,r?+r[1]:10]}
function bodyKg(s){const m=String(s||'').match(/맨몸\s*[x×*X]\s*(\d+)/);return m?[0,+m[1]]:null}
function fmtWR(w,r){return `${w?w:'맨몸'}x${r}`}
function parseKg(s){const m=String(s||'').replace(/kg/gi,'').match(/(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+)/);return m?[+m[1],+m[2]]:null}
function guideOf(e){return GN[e.n]||e.g||null}
function effEx(k,i,e,st){return st&&st.sw&&e.alt?Object.assign({},e,{n:e.alt,alt:e.n,g:null,why:'대체 운동'}):e}
/* past entries for an exercise by name, newest first (same exercise can sit on different days/slots) */
function hist(name,max){const out=[];for(const d of allDates()){if(d===today)continue;const lg=store.get('pt-log-'+d,{});
  Object.keys(BASE).forEach(k=>Object.entries(lg[k]||{}).forEach(([i,st])=>{if(st&&st.kg&&(st.n||(BASE[k].ex[i]||{}).n)===name)out.push({d,kg:st.kg,n:(st.sets||[]).filter(Boolean).length})}));
  if(out.length>=max)break}return out.slice(0,max)}
function lastFor(k,i,name){return hist(name||DAYS[k].ex[i].n,1)[0]||null}
function repRange(r){const m=String(r).match(/(\d+)\s*~\s*(\d+)/);if(m)return [+m[1],+m[2]];const s=String(r).match(/(\d+)/);return s?[+s[1],+s[1]]:[8,12]}
/* double progression: fill every set at the top of the rep range -> add weight; miss sets twice in a row -> back off 10% */
function recommend(k,i,e){const H=hist(e.n,2);
  /* trainer's weight for this week wins until the member has trained that exercise since the week started */
  const cw=COACH&&COACH.w[e.n];if(cw&&!(H[0]&&H[0].d>=COACH.week))return {w:cw[0],r:cw[1],why:'트레이너 지정 (이번 주 코칭)'};
  if(!H.length)return null;const p=parseKg(H[0].kg)||bodyKg(H[0].kg);if(!p)return null;
  let [w,r]=p;const [lo,hi]=repRange(e.r),full=H[0].n>=e.s,db=/^한 손/.test(e.kg)||(e.w&&e.w[2]==='db');
  if(full&&r>=hi){if(!w)return {w,r:r+1,why:'목표 횟수 다 채움 → 1회 더'};
    const inc=db?2:(k==='LG'||/데드/.test(e.n))&&w>=60?5:2.5;return {w:+(w+inc).toFixed(1),r:lo,why:`목표 횟수 다 채움 → +${inc}kg`}}
  if(full)return {w,r:Math.min(hi,r+1),why:'같은 무게로 1회 더'};
  if(H[1]&&H[1].n<e.s&&w)return {w:rnd(w*.9,db?2:2.5),r:lo,why:'2번 연속 세트를 못 채움 → 10% 낮춰서 다시'};
  return {w,r,why:'세트를 다 못 채움 → 같은 무게로 다시'}}
function sentLabel(){return '오늘 기록 복사'}
function finishDay(){copyText(buildLog(today,log))}
async function copyText(txt){
  try{await navigator.clipboard.writeText(txt);toast('클립보드에 복사했습니다');return}catch(e){}
  /* older iOS / in-app browsers: copy through a hidden textarea */
  try{const ta=document.createElement('textarea');ta.value=txt;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.appendChild(ta);
    ta.select();ta.setSelectionRange(0,txt.length);const okc=document.execCommand('copy');ta.remove();if(okc){toast('클립보드에 복사했습니다');return}}catch(e){}
  {const o=document.getElementById('clear');o.hidden=false;o.innerHTML=`<div class="box" style="text-align:left"><h2 style="font-size:22px">길게 눌러 전체 복사</h2><textarea id="cpy" readonly>${esc(txt)}</textarea><button class="btn ghost" id="cx" type="button">닫기</button></div>`;const ta=document.getElementById('cpy');ta.focus();ta.select();document.getElementById('cx').onclick=()=>{o.hidden=true;o.innerHTML=''}}
}
/* items of a session: one day = all exercises; two days = first 4 of each (main lifts first) */
function items(keys){
  if(keys.length===1)return DAYS[keys[0]].ex.map((e,i)=>({k:keys[0],i,e})).filter(x=>!x.e.off);
  return keys.flatMap(k=>DAYS[k].ex.map((e,i)=>({k,i,e})).filter(x=>!x.e.off).slice(0,4));
}
function prog(lg,its){let t=0,d=0;its.forEach(({k,i,e})=>{t+=e.s;d+=Math.min(e.s,setsDone(lg,k,i))});return [d,t]}
function sname(keys){return keys.map(k=>DAYS[k].name).join(' + ')}

/* ---------- rest timer ---------- */
let tInt;
function startTimer(sec,label){
  const el=document.getElementById('timer');clearInterval(tInt);
  const end=Date.now()+sec*1000;el.hidden=false;el.className='timer';
  el.innerHTML=`<b id="tt"></b><div class="tl"><span id="tlab">휴식 · ${esc(label)}</span><div class="tbar"><i id="tb"></i></div></div><button type="button" id="tskip">건너뛰기</button>`;
  document.getElementById('tskip').onclick=()=>{clearInterval(tInt);el.hidden=true};
  const tick=()=>{const left=Math.max(0,Math.round((end-Date.now())/1000));
    document.getElementById('tt').textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;
    document.getElementById('tb').style.width=(left/sec*100)+'%';
    if(left<=0){clearInterval(tInt);el.className='timer go';document.getElementById('tt').textContent='GO';document.getElementById('tlab').textContent='다음 세트 시작';setTimeout(()=>{if(el.className==='timer go')el.hidden=true},6000)}};
  tick();tInt=setInterval(tick,250);
}

/* ---------- header + tabs ---------- */
function renderHeader(){
  const x=totalXP(),lv=lvOf(x),inLv=x%XP_LV;
  document.getElementById('hdr').innerHTML=`<div class="lv"><span><small>LV</small><b>${lv}</b></span></div>
  <div class="xp"><div class="xp-top"><span>${now.getMonth()+1}/${now.getDate()} (${WEEKDAY[now.getDay()]}) ${PROF&&PROF.name?`<em class="sync">· ${esc(PROF.name)}</em>`:''}${syncOn()?`<em class="sync ${syncState==='ok'?'cloud':'local'}">${{ok:syncUnverified?'● 보냄':'● 저장됨',busy:'● 저장 중',wait:'● 대기',auth:'● PIN 확인'}[syncState]||'● 연결 중'}</em>`:''}</span><span><b>${inLv}</b> / ${XP_LV} XP</span></div><div class="xpbar"><i style="width:${inLv/XP_LV*100}%"></i></div></div>
  <div class="streak"><b>${weekCount()}/${WEEK_GOAL}</b>이번 주</div>${SYNC_URL&&PROF&&!PROF.pin?`<div class="offwarn">내 정보에서 PIN을 정하면 기록이 팀 시트에 자동 저장돼요</div>`:syncState==='auth'?`<div class="offwarn">시트 저장 안 됨: ${/PIN이 맞지/.test(syncErr)?'이 이름이 다른 PIN으로 이미 등록돼 있어요. 내 정보에서 PIN을 확인하거나, 다른 사람이면 이름을 바꿔 주세요 (예: 김민수)':esc(syncErr)}</div>`:syncState==='wait'?`<div class="offwarn">시트 저장 대기 중이에요. 기록은 폰에 안전하게 있고, 연결되면 자동으로 올라가요${syncErr?` (원인: ${esc(syncErr)})`:''}</div>`:''}`;
}
const ICONS={
  home:'<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  train:'<svg viewBox="0 0 24 24"><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/></svg>',
  food:'<svg viewBox="0 0 24 24"><path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/></svg>',
  log:'<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  set:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>'};
function renderTabs(){
  const t=[['home','오늘'],['train','운동'],['food','식단'],['log','기록'],['set','내 정보']];
  const el=document.getElementById('tabs');el.innerHTML='';
  t.forEach(([k,l])=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-selected',view===k);b.innerHTML=ICONS[k]+l;b.onclick=()=>go(k);el.appendChild(b)});
}
function go(v){view=v;homeMode='';try{history.replaceState(null,'',v==='home'?location.pathname:'#'+v)}catch(e){};render();window.scrollTo({top:0})}

/* ---------- HOME ---------- */
function ring(p,txt){const r=36,C=2*Math.PI*r;return `<svg class="ring" viewBox="0 0 84 84" aria-hidden="true"><circle class="bgc" cx="42" cy="42" r="${r}"/><circle class="fgc" cx="42" cy="42" r="${r}" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-p)}" transform="rotate(-90 42 42)"/><text x="42" y="49" text-anchor="middle">${txt}</text></svg>`}
function newList(){const L=ORDER.flatMap(k=>DAYS[k].ex.filter(e=>e.isNew).map(e=>`${DAYS[k].name} · ${esc(e.n)}`));
  return L.length?`<p class="small" style="margin:0">이번 사이클 새 종목: ${L.join(', ')}</p>`:'<p class="small" style="margin:0">첫 사이클은 기본 루틴 그대로. 한 바퀴 끝내면 부위마다 보조 종목이 조금씩 바뀌어요</p>'}
function cycleBar(){return `<div class="cyc">${ORDER.map(k=>`<span class="${cycle.done.includes(k)?'on':''}${k===nextDay()?' nx':''}" style="--c:${col(k)}">${DAYS[k].name}</span>`).join('')}</div>`}
/* ---------- growing character + titles ---------- */
const TITLES=[[1,'헬린이'],[3,'루키'],[6,'레귤러'],[10,'아이언'],[15,'스틸'],[20,'비스트'],[25,'몬스터'],[30,'레전드']];
function titleOf(lv){let t=TITLES[0];TITLES.forEach(x=>{if(lv>=x[0])t=x});return t[1]}
function nextTitle(lv){return TITLES.find(x=>x[0]>lv)}
/* bodybuilding poses: arm joints are offsets from body centre, S = shoulder half-width, W = waist half-width */
const POSES=[
  {k:'relax',n:'릴랙스',a:(S,W)=>({L:{e:[-(S+7),118],w:[-(S+6),139]},R:{e:[S+7,118],w:[S+6,139]}}),z:'bb',face:'smile'},
  {k:'fdb',n:'프론트 더블 바이셉스',a:(S,W)=>({L:{e:[-(S+19),93],w:[-(S+17),68]},R:{e:[S+19,93],w:[S+17,68]}}),z:'ff',face:'grin'},
  {k:'fls',n:'프론트 랫 스프레드',a:(S,W)=>({L:{e:[-(S+15),113],w:[-(W+2),131]},R:{e:[S+15,113],w:[W+2,131]}}),z:'ff',face:'strain',lat:4},
  {k:'sc',n:'사이드 체스트',a:(S,W)=>({L:{e:[-(S+1),119],w:[10,113]},R:{e:[S+9,123],w:[15,117]}}),z:'ff',face:'grin',tilt:5},
  {k:'st',n:'사이드 트라이셉스',a:(S,W)=>({L:{e:[-(S+3),117],w:[W+8,135]},R:{e:[S+6,120],w:[S+4,143]}}),z:'fb',face:'smile',tilt:-5},
  {k:'abs',n:'업도미널 앤 사이',a:(S,W)=>({L:{e:[-(S+13),62],w:[-15,44]},R:{e:[S+13,62],w:[15,44]}}),z:'ff',face:'strain',abs:1},
  {k:'mm',n:'모스트 머스큘러',a:(S,W)=>({L:{e:[-(S+9),110],w:[-6,122]},R:{e:[S+9,110],w:[6,122]}}),z:'ff',face:'strain',traps:1},
  {k:'bdb',n:'백 더블 바이셉스',a:(S,W)=>({L:{e:[-(S+19),93],w:[-(S+17),68]},R:{e:[S+19,93],w:[S+17,68]}}),z:'ff',back:1},
  {k:'bls',n:'백 랫 스프레드',a:(S,W)=>({L:{e:[-(S+15),113],w:[-(W+2),131]},R:{e:[S+15,113],w:[W+2,131]}}),z:'ff',back:1,lat:5},
  {k:'vac',n:'배큠 포즈',a:(S,W)=>({L:{e:[-(S+13),62],w:[-15,44]},R:{e:[S+13,62],w:[15,44]}}),z:'ff',face:'smile',vac:1},
  {k:'one',n:'원암 바이셉스',a:(S,W)=>({L:{e:[-(S+13),114],w:[-(W+2),132]},R:{e:[S+19,93],w:[S+17,68]}}),z:'ff',face:'grin'},
  {k:'v',n:'빅토리',a:(S,W)=>({L:{e:[-(S+12),70],w:[-(S+20),42]},R:{e:[S+12,70],w:[S+20,42]}}),z:'ff',face:'grin'},
  {k:'twist',n:'트위스트 이두',a:(S,W)=>({L:{e:[-(S+18),98],w:[-(S+8),72]},R:{e:[S+16,104],w:[S+21,80]}}),z:'ff',face:'grin',tilt:3},
  {k:'arnold',n:'아놀드 클래식',a:(S,W)=>({L:{e:[-(S+16),112],w:[-(S+2),96]},R:{e:[S+18,90],w:[S+12,64]}}),z:'ff',face:'grin',tilt:-3}
];
/* character look: start body type + colours. Everyone starts out of shape; fat melts first (ef), muscle builds over the whole range (m) */
const BODIES={
  belly:{n:'든든형',d:'배 쪽부터 가벼워지면서 탄탄해져요',gut:1,S:28,W:24,B:20,ru:5.5,re:4.8,rw:4,rd:7,rt:7.5,ra:5,neck:12,jaw:4,cheek:2,chin:.6,moob:.6},
  skinny:{n:'슬림형',d:'근육이 붙으면서 어깨가 넓어져요',gut:0,S:21,W:15.5,B:0,ru:3.6,re:3.3,rw:3.2,rd:4.2,rt:5.2,ra:3.7,neck:7.5,jaw:1,cheek:-2.5,chin:0,moob:0},
  chubby:{n:'포근형',d:'전체적으로 가벼워지고 단단해져요',gut:.8,S:35,W:31,B:13,ru:9.5,re:8,rw:6,rd:10,rt:12.5,ra:7.5,neck:16,jaw:2,cheek:5,chin:1,moob:1},
  skinnyfat:{n:'말랑형',d:'팔다리엔 근육이, 배는 납작하게',gut:.9,S:24,W:22,B:18,ru:4.2,re:3.8,rw:3.4,rd:5,rt:6.5,ra:4.2,neck:9,jaw:2,cheek:1,chin:.3,moob:.4}};
const BODY_END={gut:0,S:46,W:20,B:0,ru:12.5,re:8.5,rw:6.5,rd:15,rt:15,ra:7.5,neck:20,jaw:9,cheek:0,chin:0,moob:0};
const SKINS=[['#ffe6d2','#f9d0b0','#e0aa82'],['#ffd9b8','#f4bd92','#d9946a'],['#f0c08f','#d99c68','#b0703f'],['#b9805a','#9a6040','#6e3f25']];
const HAIRS=[['spiky','삐죽 머리'],['buzz','짧은 머리'],['bald','민머리'],['long','긴 머리'],['pony','포니테일']];
const HAIRC=[['#1e1d22','#55545c'],['#5a3a24','#8a5e40'],['#c9963a','#ecc36e'],['#8e8e94','#c4c4ca']];
const ACCS=[['#ff7a3d','#ff5b1f','#d9440f'],['#7c9bff','#4f6ef7','#3450c9'],['#5ed39c','#2fb67a','#1e8a5a'],['#ff8ab8','#ff5c9a','#d93a78'],['#b29bff','#8a6cff','#6648d9']];
const LOOK0={body:'belly',skin:1,hair:'spiky',hairc:0,acc:0};
function lookOf(l){return Object.assign({},LOOK0,l||{})}
/* pose that suits a level: relaxed beginner, flexing later */
function poseFor(lv){return lv<5?0:lv<12?1:lv<20?2:lv<27?3:6}
let svgUid=0;
function charSVG(m,pose,look){
  const L=lookOf(look),BD=BODIES[L.body]||BODIES.belly,ef=Math.min(1,m*1.7),lp=(k,e)=>BD[k]+(BODY_END[k]-BD[k])*e;
  const sk=SKINS[L.skin]||SKINS[1],hc=HAIRC[L.hairc]||HAIRC[0],ac=ACCS[L.acc]||ACCS[0],u='c'+(++svgUid);
  const P=POSES[typeof pose==='number'?pose%POSES.length:pose?1:0];
  const f=v=>(+v).toFixed(1),c=80,OL='#1a1410',SW=2.4;
  const S=lp('S',m),W0=lp('W',ef),W=W0+(P.lat?P.lat*(.4+m):0)-(P.vac?3+2*m:0),B=lp('B',ef);
  const cap=(ax,ay,ra,bx,by,rb)=>{const dx=bx-ax,dy=by-ay,L=Math.hypot(dx,dy)||1,nx=-dy/L,ny=dx/L;
    return `M${f(ax+nx*ra)} ${f(ay+ny*ra)} L${f(bx+nx*rb)} ${f(by+ny*rb)} A${f(rb)} ${f(rb)} 0 0 0 ${f(bx-nx*rb)} ${f(by-ny*rb)} L${f(ax-nx*ra)} ${f(ay-ny*ra)} A${f(ra)} ${f(ra)} 0 0 0 ${f(ax+nx*ra)} ${f(ay+ny*ra)}Z`};
  const st=`stroke="${OL}" stroke-width="${SW}" stroke-linejoin="round"`,SK=`url(#sk${u})`;
  // ---- arms
  const J=P.a(S,W0),ru=lp('ru',m),re=lp('re',m),rw=lp('rw',m),rd=lp('rd',m);
  const arm=s=>{const j=s<0?J.L:J.R,sx=c+s*(S-3),sy=95,ex=c+j.e[0],ey=j.e[1],wx=c+j.w[0],wy=j.w[1];
    const dx=ex-sx,dy=ey-sy,L=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx)*180/Math.PI;
    // biceps bulges toward the folded forearm; bend 0 (straight) .. 1 (fully folded)
    const cr=dx*(wy-ey)-dy*(wx-ex),fl=Math.hypot(wx-ex,wy-ey)||1,bend=Math.min(1,Math.max(0,1-(dx*(wx-ex)+dy*(wy-ey))/(L*fl))*.9);
    const sg=cr>0?1:-1,nx=-dy/L*sg,ny=dx/L*sg,off=ru*(.25+.35*bend);
    const bx=(sx+ex)/2+nx*off,by=(sy+ey)/2+ny*off;
    const bic=m>.15?`<ellipse cx="${f(bx)}" cy="${f(by)}" rx="${f(L*.3+2*m)}" ry="${f(ru*(.7+.15*bend)+3.5*m*bend+1.5*m)}" fill="${SK}" ${st} transform="rotate(${f(ang)} ${f(bx)} ${f(by)})"/>`:'';
    const up_=wy<ey-6;
    const fist=`<circle cx="${f(wx)}" cy="${f(wy+(up_?-2:3))}" r="${f(rw+2.2)}" fill="${SK}" ${st}/>`+
      (up_&&!P.back?`<path d="M${f(wx-s*3)} ${f(wy-5)} q${f(s*3)} -2 ${f(s*5)} 0" stroke="${OL}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`:'');
    const delt=`<circle cx="${f(sx+s*2)}" cy="${f(sy-1)}" r="${f(rd*(bend>.4?.85:1))}" fill="${SK}" ${st}/>`;
    const up=`<path d="${cap(sx,sy,ru,ex,ey,re)}" fill="${SK}" ${st}/>`,fo=`<path d="${cap(ex,ey,re,wx,wy,rw)}" fill="${SK}" ${st}/>`;
    return bend>.35?`${delt}${fo}${up}${bic}${fist}`:`${fo}${fist}${up}${bic}${delt}`};
  const zL=P.z[0],zR=P.z[1],armsB=(zL==='b'?arm(-1):'')+(zR==='b'?arm(1):''),armsF=(zL==='f'?arm(-1):'')+(zR==='f'?arm(1):'');
  // ---- legs & shoes
  const rt=lp('rt',m),ra=lp('ra',m),hx=W0*.52,ax=W0*.48;
  const leg=s=>`<path d="${cap(c+s*hx,148,rt,c+s*ax,181,ra)}" fill="${SK}" ${st}/>`+
    (m>.45?`<path d="M${f(c+s*(hx+rt*.15))} 152 q${f(-s*4)} 10 ${f(-s*1)} 20" stroke="${sk[2]}" stroke-width="1.4" fill="none" opacity="${f(Math.min(1,(m-.45)*3))}"/>`:'')+
    `<path d="M${f(c+s*ax-(s>0?7:10))} 190 Q${f(c+s*ax-(s>0?8:10))} 179 ${f(c+s*ax)} 179 Q${f(c+s*ax+(s>0?10:8))} 179 ${f(c+s*ax+(s>0?11:8))} 190Z" fill="#f5f5f2" ${st}/>`+
    `<path d="M${f(c+s*ax-6)} 186 Q${f(c+s*ax)} 182 ${f(c+s*ax+6)} 185" stroke="${ac[1]}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  // ---- torso
  const skinT=`M${f(c-S)} 92 C${f(c-S-1)} 108 ${f(c-W-B)} 118 ${f(c-W)} 136 L${f(c+W)} 136 C${f(c+W+B)} 118 ${f(c+S+1)} 108 ${f(c+S)} 92 Q${c} 80 ${f(c-S)} 92Z`;
  const neckY=P.back?90:99;
  const tank=`M${f(c-S+10)} 86 L${c-11} 86 Q${c} ${neckY} ${c+11} 86 L${f(c+S-10)} 86 Q${f(c+S-7)} 97 ${f(c+S-3)} 105 C${f(c+S)} 116 ${f(c+W+B)} 121 ${f(c+W+.5)} 137 L${f(c-W-.5)} 137 C${f(c-W-B)} 121 ${f(c-S)} 116 ${f(c-S+3)} 105 Q${f(c-S+7)} 97 ${f(c-S+10)} 86Z`;
  const mo=v=>f(Math.min(1,v)),dk=ac[2];
  let det='';
  if(P.back){
    det=`<path d="M${c} 92 V132" stroke="${dk}" stroke-width="1.6" opacity=".7"/>`+
      (m>.3?`<path d="M${f(c-S+6)} 102 Q${f(c-W-4)} 118 ${f(c-6)} 132 M${f(c+S-6)} 102 Q${f(c+W+4)} 118 ${f(c+6)} 132" stroke="${dk}" stroke-width="1.6" fill="none" opacity="${mo((m-.3)*3)}"/>`:'')+
      (m>.5?`<path d="M${f(c-S*.55)} 95 Q${f(c-S*.3)} 101 ${c-3} 98 M${f(c+S*.55)} 95 Q${f(c+S*.3)} 101 ${c+3} 98" stroke="${dk}" stroke-width="1.4" fill="none" opacity="${mo((m-.5)*3)}"/>`:'');
  }else{
    const pec=m>.35?`<path d="M${f(c-S*.62)} 104 Q${f(c-S*.3)} ${f(112+3*m)} ${c} 105 Q${f(c+S*.3)} ${f(112+3*m)} ${f(c+S*.62)} 104" stroke="${dk}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="${mo((m-.35)*3)}"/>`:'';
    const mb=lp('moob',ef);
    const moob=mb>.05?`<path d="M${f(c-S*.7)} 103 Q${f(c-S*.45)} ${f(117+4*mb)} ${c-3} 108 M${f(c+S*.7)} 103 Q${f(c+S*.45)} ${f(117+4*mb)} ${c+3} 108" stroke="${dk}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="${mo(mb*1.2)}"/>`:'';
    const ab=P.abs||P.vac?Math.max(.6,m):m;
    const abs=ab>.55?`<g stroke="${dk}" stroke-width="1.5" stroke-linecap="round" opacity="${mo((ab-.55)*3)}"><path d="M${c} 112v20M${c-8} 118h5M${c+3} 118h5M${c-8} 125h5M${c+3} 125h5${P.abs?`M${c-8} 131h5M${c+3} 131h5`:''}"/></g>`:'';
    const vac=P.vac?`<path d="M${f(c-W+3)} 121 Q${c} 127 ${f(c+W-3)} 121" stroke="${dk}" stroke-width="1.6" fill="none"/>`:'';
    const belly=B>4&&!P.vac?`<path d="M${f(c-W-B*.6)} 124 Q${c} ${f(132+B*.4)} ${f(c+W+B*.6)} 124" stroke="${dk}" stroke-width="1.6" fill="none" opacity="${mo(B/14)}"/>`:'';
    det=pec+moob+abs+vac+belly;
  }
  const tr=m>.4||P.traps?`<path d="M${c-7} 80 Q${f(c-S*.6)} ${P.traps?78:82} ${f(c-S+4)} 89 M${c+7} 80 Q${f(c+S*.6)} ${P.traps?78:82} ${f(c+S-4)} 89" stroke="${OL}" stroke-width="1.6" fill="none" opacity="${P.traps?.85:.6}"/>`:'';
  const shorts=`M${f(c-W0-1.5)} 134 L${f(c+W0+1.5)} 134 L${f(c+W0+4)} 155 L${c+2} 155 L${c} 147 L${c-2} 155 L${f(c-W0-4)} 155Z`;
  // ---- head
  const jaw=lp('jaw',m),cw=lp('cheek',ef),chin=lp('chin',ef),xl=55-cw,xr=105+cw;
  const face=`M55 46 Q${f(xl)} ${f(70+jaw*.3)} ${f(66-jaw*.4-cw*.6)} ${f(74+jaw*.2)} Q${c} ${f(80+jaw*.15)} ${f(94+jaw*.4+cw*.6)} ${f(74+jaw*.2)} Q${f(xr)} ${f(70+jaw*.3)} 105 46 Q105 23 ${c} 23 Q55 23 55 46Z`;
  const dchin=chin>.1?`<path d="M${f(67-cw*.4)} ${f(79+jaw*.2)} Q${c} ${f(89+chin*3)} ${f(93+cw*.4)} ${f(79+jaw*.2)}Z" fill="${SK}" ${st} stroke-width="1.8" opacity="${mo(chin*1.4)}"/>`:'';
  const H=L.hair,band=(back)=>back?`<path d="M55 37 Q${c} 31 105 37 L105 43 Q${c} 37 55 43Z" fill="${ac[1]}" ${st} stroke-width="1.8"/><path d="M56 38 l-9 -5 l2 7 l-6 3 l11 0Z" fill="${ac[1]}" ${st} stroke-width="1.6"/>`:
    `<path d="M55 37 Q${c} 28 105 37 L105 43 Q${c} 34 55 43Z" fill="${ac[1]}" ${st} stroke-width="1.8"/><path d="M104 38 l9 -5 l-2 7 l6 3 l-11 0Z" fill="${ac[1]}" ${st} stroke-width="1.6"/>`;
  const hairBehind=H==='long'?`<path d="M50 86 Q40 46 58 24 Q80 10 102 24 Q120 46 110 86 Q100 82 99 64 L61 64 Q60 82 50 86Z" fill="${hc[0]}" ${st}/>`:
    H==='pony'?`<path d="M99 28 Q126 30 120 68 Q116 54 104 42Z" fill="${hc[0]}" ${st}/>`:'';
  const hairFront=H==='spiky'?`<path d="M53 50 Q49 28 63 18 L61 8 L71 14 L76 2 L84 13 L95 5 L94 16 L107 13 L102 23 Q111 32 107 50 Q103 38 92 35 Q82 42 70 37 Q60 41 53 50Z" fill="${hc[0]}" ${st}/><path d="M66 20 Q72 16 80 17" stroke="${hc[1]}" stroke-width="2" fill="none" stroke-linecap="round"/>`:
    H==='buzz'||H==='pony'?`<path d="M54 46 Q52 22 80 19 Q108 22 106 46 Q101 32 80 30 Q59 32 54 46Z" fill="${hc[0]}" ${st}/><path d="M66 24 Q72 21 80 21" stroke="${hc[1]}" stroke-width="2" fill="none" stroke-linecap="round"/>`:
    H==='long'?`<path d="M55 48 Q51 24 80 18 Q109 24 105 48 Q98 33 86 33 Q74 40 62 35 Q57 40 55 48Z" fill="${hc[0]}" ${st}/><path d="M66 23 Q72 19 80 20" stroke="${hc[1]}" stroke-width="2" fill="none" stroke-linecap="round"/>`:
    `<ellipse cx="70" cy="29" rx="7" ry="3" fill="#fff" opacity=".35"/>`;
  let head;
  if(P.back){
    const backHair=H==='bald'?'':H==='spiky'?`<path d="M53 52 Q49 26 63 18 L61 8 L71 14 L76 2 L84 13 L95 5 L94 16 L107 13 L102 23 Q111 32 107 52 Q106 66 95 70 Q${c} 74 65 70 Q54 66 53 52Z" fill="${hc[0]}" ${st}/>`:
      `<path d="M53 52 Q50 20 80 18 Q110 20 107 52 Q106 66 95 70 Q${c} 74 65 70 Q54 66 53 52Z" fill="${hc[0]}" ${st}/>`+(H==='long'?`<path d="M54 60 Q50 80 52 88 Q80 94 108 88 Q110 80 106 60Z" fill="${hc[0]}" ${st}/>`:'');
    head=`${hairBehind&&H==='pony'?hairBehind:''}<circle cx="54" cy="52" r="5" fill="${SK}" ${st}/><circle cx="106" cy="52" r="5" fill="${SK}" ${st}/>
    <path d="${face}" fill="${SK}" ${st}/>${backHair}${band(true)}`;
  }else{
    const fc=P.face||'grin';
    const brow=fc!=='smile'||m>.5?(fc==='strain'?`M62 45 L75 51 M98 45 L85 51`:`M63 47 L75 50 M97 47 L85 50`):`M63 49 L75 47 M97 49 L85 47`;
    const mouth=fc==='grin'?`<path d="M71 66 Q${c} 76 89 66Z" fill="#fff" ${st} stroke-width="1.8"/>`:
      fc==='strain'?`<rect x="70" y="65" width="20" height="7" rx="2.5" fill="#fff" ${st} stroke-width="1.8"/><path d="M75 65v7M80 65v7M85 65v7M70 68.5h20" stroke="${OL}" stroke-width="1"/>`:
      (m<.25?`<ellipse cx="${c}" cy="68" rx="3" ry="2.4" fill="#7a2e1a"/>`:`<path d="M73 67 Q${c} 72 87 67" stroke="${OL}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
    const veins=fc==='strain'?`<path d="M99 30 l3 4 l-3 3 l3 3" stroke="#d9440f" stroke-width="1.4" fill="none" stroke-linecap="round"/>`:'';
    const sweat=m<.25||fc==='strain'?`<path d="M108 40 q4 6 0 9 q-4 -3 0 -9Z" fill="#9fdcf0" stroke="#3d8bb0" stroke-width="1"/>`:'';
    head=`${hairBehind}<circle cx="54" cy="52" r="5" fill="${SK}" ${st}/><circle cx="106" cy="52" r="5" fill="${SK}" ${st}/>
    <path d="${face}" fill="${SK}" ${st}/>${dchin}
    ${hairFront}${band(false)}
    <path d="${brow}" stroke="${OL}" stroke-width="3.2" stroke-linecap="round"/>
    <g class="eyes"><ellipse cx="69" cy="56" rx="4.4" ry="${fc==='strain'?3.6:5.2}" fill="#fff" ${st} stroke-width="1.6"/><ellipse cx="91" cy="56" rx="4.4" ry="${fc==='strain'?3.6:5.2}" fill="#fff" ${st} stroke-width="1.6"/>
     <ellipse cx="70" cy="57" rx="2.7" ry="${fc==='strain'?2.6:3.5}" fill="#2a1c14"/><ellipse cx="90" cy="57" rx="2.7" ry="${fc==='strain'?2.6:3.5}" fill="#2a1c14"/>
     <circle cx="71" cy="55.3" r="1.1" fill="#fff"/><circle cx="91" cy="55.3" r="1.1" fill="#fff"/></g>
    <path d="M${c} 60 q-2 4 1 5" stroke="${sk[2]}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="${f(62-cw*.5)}" cy="64" rx="${f(4+Math.max(0,cw)*.4)}" ry="2.2" fill="#ff8a7a" opacity=".45"/><ellipse cx="${f(98+cw*.5)}" cy="64" rx="${f(4+Math.max(0,cw)*.4)}" ry="2.2" fill="#ff8a7a" opacity=".45"/>
    ${mouth}${veins}${sweat}`;
  }
  const aura=m>.66?`<circle cx="${c}" cy="110" r="${f(60+20*m)}" fill="url(#au${u})" opacity="${f((m-.66)*2.6)}"/>`+
    [[22,60],[138,52],[30,140],[132,128]].map(([x,y],i)=>`<path class="spk" style="animation-delay:${i*.4}s" d="M${x} ${y-5} L${x+1.5} ${y-1.5} L${x+5} ${y} L${x+1.5} ${y+1.5} L${x} ${y+5} L${x-1.5} ${y+1.5} L${x-5} ${y} L${x-1.5} ${y-1.5}Z" fill="#ffd27a"/>`).join(''):'';
  /* round gut: the tank stretches over it and skin peeks out under the hem */
  const gt=lp('gut',ef),gw=W+B*.5,gutSVG=gt>.06&&!P.back?`<ellipse cx="${c}" cy="${f(136+2*gt)}" rx="${f(gw*.8)}" ry="${f(3+5*gt)}" fill="${SK}" ${st}/><path d="M${c-2.5} ${f(139+4*gt)} q2.5 2.5 5 0" stroke="${OL}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="${mo(gt*1.5)}"/>`:'',
    gutBall=gt>.06&&!P.back?`<ellipse cx="${c}" cy="${f(126-2*gt)}" rx="${f(gw)}" ry="${f(6+10*gt)}" fill="url(#tk${u})" ${st}/><path d="M${f(c-gw*.5)} ${f(118-4*gt)} Q${c} ${f(113-5*gt)} ${f(c+gw*.5)} ${f(118-4*gt)}" stroke="#fff" stroke-width="2" fill="none" opacity=".25" stroke-linecap="round"/>`:'';
  const flexing=P.k!=='relax',nk=lp('neck',m);
  return `<svg class="buddy${flexing?' flex':''}" viewBox="0 0 160 200" aria-hidden="true">
  <defs><linearGradient id="sk${u}" x1="0" x2="1"><stop offset="0" stop-color="${sk[0]}"/><stop offset=".55" stop-color="${sk[1]}"/><stop offset="1" stop-color="${sk[2]}"/></linearGradient>
  <linearGradient id="tk${u}" x1="0" x2="1"><stop offset="0" stop-color="${ac[0]}"/><stop offset=".6" stop-color="${ac[1]}"/><stop offset="1" stop-color="${ac[2]}"/></linearGradient>
  <radialGradient id="au${u}"><stop offset="0" stop-color="${ac[1]}" stop-opacity=".55"/><stop offset="1" stop-color="${ac[1]}" stop-opacity="0"/></radialGradient></defs>
  ${aura}<ellipse cx="${c}" cy="193" rx="${f(Math.max(24,W0+S*.4)+4)}" ry="4.5" fill="#000" opacity=".45"/>
  <g class="bd"><g transform="rotate(${P.tilt||0} ${c} 190)">
   ${leg(-1)}${leg(1)}
   <path d="${shorts}" fill="#26262b" ${st}/><path d="M${f(c-W0-1)} 138 L${f(c-W0-3)} 154 M${f(c+W0+1)} 138 L${f(c+W0+3)} 154" stroke="${ac[1]}" stroke-width="2.2"/>
   <g class="arms">${armsB}</g>
   <path d="${skinT}" fill="${SK}" ${st}/>
   <rect x="${f(c-nk/2)}" y="70" width="${f(nk)}" height="16" fill="${SK}" ${st}/>
   ${gutSVG}<path d="${tank}" fill="url(#tk${u})" ${st}/>${gutBall}${det}${tr}
   <g class="arms">${armsF}</g>
   <g class="head">${head}</g>
  </g></g></svg>`;
}
let poseI=null;
function buddyCard(){
  const x=totalXP(),lv=lvOf(x),m=Math.min(1,(lv-1)/29),nt=nextTitle(lv),trained=doneKeys(log).length>0;
  return `<section class="buddyc"><button type="button" class="bwrap" id="buddy" aria-label="캐릭터 포즈">${charSVG(m,poseI??(trained?Math.max(1,poseFor(lv)):0),prof().look)}<span class="pose">${poseI==null?'탭해서 포즈':POSES[poseI].n}</span></button>
  <div class="binfo"><span class="eyebrow">LV ${lv}</span><h2>${titleOf(lv)}</h2>
  <div class="bxp"><i style="width:${(x%XP_LV)/XP_LV*100}%"></i></div>
  <p class="small">${nt?`LV ${nt[0]}부터 <b>${nt[1]}</b>. 레벨이 오를수록 몸이 커져요`:'최고 칭호 달성'}${trained?' · 오늘 운동 완료 💪':''}</p></div></section>`;
}
function coachCard(){const c=COACH;if(!c)return '';const sp=s=>String(s||'').split(/\s+\/\s+/).filter(Boolean);
  const W=Object.entries(c.w).map(([n,v])=>`${esc(n)} <b>${esc(fmtWR(v[0],v[1]))}</b>`),S=Object.entries(c.sw).map(([a,b])=>`${esc(a)} → <b>${esc(b)}</b>`);
  return `<div class="panel fb"><div class="row"><h3>이번 주 코칭</h3><span class="sp"></span><span class="small">${md(c.week)} 주</span></div>
  ${c.comment?`<div class="fbh"><p>${esc(c.comment)}</p></div>`:''}
  ${sp(c.good).length?`<div class="fbs"><small>잘한 점</small><ul>${sp(c.good).map(x=>`<li class="ok">${esc(x)}</li>`).join('')}</ul></div>`:''}
  ${sp(c.fix).length?`<div class="fbs fix"><small>고칠 점</small><ul>${sp(c.fix).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
  ${sp(c.goal).length?`<div class="fbs"><small>다음 주 목표</small><ul>${sp(c.goal).map(x=>`<li>👉 ${esc(x)}</li>`).join('')}</ul></div>`:''}
  ${W.length||S.length?`<div class="fbs"><small>루틴 조정 (운동 화면에 자동 반영)</small><ul>${W.map(x=>`<li>${x}</li>`).join('')}${S.map(x=>`<li>${x}</li>`).join('')}</ul></div>`:''}</div>`}
function renderHome(){
  const dk=doneKeys(log); let hero;
  if(dk.length){
    const its=items(dk),[dn,tt]=prog(log,its);
    hero=`<section class="hero" style="--c:${col(dk[0])}"><div class="row"><div style="flex:1;min-width:0"><span class="tag">Complete</span><h2>${sname(dk)}</h2><p>오늘 운동 끝. 식단 퀘스트만 챙기면 완벽해요.${log.cardio?` 유산소 ${esc(log.cardio.t)} ${esc(log.cardio.min||'')}분도 했어요.`:''}</p></div>${ring(1,'✓')}</div>
    <div class="row" style="gap:8px"><button class="btn done" type="button" id="hclear">결과 보기</button><button class="btn ghost" type="button" id="hcardio2">${log.cardio?'유산소 수정':'+ 유산소 추가'}</button></div></section>`;
  } else if(log.cardio){
    hero=`<section class="hero" style="--c:var(--p-blue)"><span class="tag">CARDIO DAY</span><h2>유산소로 대체</h2><p>${esc(log.cardio.t)} ${esc(log.cardio.min||'?')}분 완료. 근력 순서는 그대로라 다음엔 <b>${DAYS[nextDay()].name}</b> 차례예요.</p>
    <div class="row" style="gap:8px"><button class="btn ghost" type="button" id="hundo">취소</button><button class="btn gold" type="button" id="hstart">그래도 ${DAYS[nextDay()].name} 하기</button></div></section>`;
  } else if(log.pass){
    hero=`<section class="hero" style="--c:var(--p-gray)"><span class="tag">REST DAY</span><h2>오늘은 패스</h2><p>쉬는 것도 루틴이에요. 순서는 밀리지 않고 다음에 <b>${DAYS[nextDay()].name}</b>부터 이어서 해요. 식단 퀘스트는 그대로!</p>
    <button class="btn ghost" type="button" id="hundo">패스 취소</button></section>`;
  } else {
    const k=nextDay(),d=DAYS[k],its=items([k]),[dn,tt]=prog(log,its);
    hero=`<section class="hero" style="--c:${col(k)}"><div class="row"><div style="min-width:0;flex:1"><span class="tag">Today · 순서상 다음</span><h2>${d.name}</h2><p>${esc(d.sub)}</p></div>${ring(dn/tt,Math.round(dn/tt*100)+'%')}</div>
    <div class="chips"><span class="chip">${d.ex.length}종목</span><span class="chip">${tt}세트</span><span class="chip">약 70분</span><span class="chip">+${200+tt*10}XP</span></div>
    <button class="btn gold" type="button" id="hstart">${dn?'이어서 하기':'운동 시작'}</button>
    <div class="alts"><button type="button" id="hother">다른 부위</button><button type="button" id="hcombo">2부위 같이</button><button type="button" id="hcardio">유산소 대체</button><button type="button" id="hpass">오늘 패스</button></div>
    ${homeMode==='cardio'?cardioForm():''}</section>`;
  }
  if(homeMode==='cardio'&&(dk.length))hero=hero.replace('</section>',cardioForm()+'</section>');
  // week strip: what actually happened
  const m=monday();let wk='';
  for(let i=0;i<7;i++){const d=new Date(m);d.setDate(m.getDate()+i);const k=ymd(d),lg=lgOf(k),dks=doneKeys(lg);
    let c='var(--line)',mark='',lbl=k>today?'':'-',cls='';
    if(dks.length){c=col(dks[0]);mark='✓';lbl=dks.map(x=>DAYS[x].name).join('+');cls=' done'}
    else if(lg.cardio){c='var(--p-blue)';mark='~';lbl='유산소';cls=' done'}
    else if(lg.pass){mark='–';lbl='패스'}
    wk+=`<div class="wd${k===today?' today':''}${cls}" style="--dc:${c}"><span>${WEEKDAY[d.getDay()]}</span><span class="dot">${mark}</span><span class="lbl">${lbl}</span></div>`}
  const info=log.info||{},meals=log.meals||{};
  const Q=[];
  Q.push([log.pass?'오늘은 패스 (휴식)':'근력 운동 또는 유산소',dk.length?200:log.cardio?100:0,active(log)||!!log.pass,'train']);
  [['L','점심 기록'],['S','16시 회사 닭가슴살 + 단백질'],['D','저녁 기록 (20:30 마감)']].forEach(([id,l])=>Q.push([l,30,meals[id]!==undefined&&meals[id]!==null,'food']));
  Q.push(['아침 공복 체중',20,!!info.w,'food']);
  Q.push(['걸음 8,000보',50,+info.steps>=8000,'food']);
  const doneN=Q.filter(q=>q[2]).length;
  return `<div class="sec">${buddyCard()}${coachCard()}${PROF&&LIFTS.some(([k])=>+(PROF.rm||{})[k])?'':`<button type="button" class="fbt" data-go="set"><span class="grade" style="width:34px;height:34px;font-size:18px">!</span><span><small>시작 무게 계산</small>내 정보에서 1RM을 입력하면 종목별 무게가 나와요</span><b>›</b></button>`}${hero}
  <div class="panel"><div class="row"><h3>루틴 순서 · 사이클 ${cycle.n+1}</h3><span class="sp"></span><span class="small">한 바퀴 돌면 종목 일부 교체</span></div>${cycleBar()}${newList()}</div>
  <div class="week">${wk}</div>
  <div class="panel"><div class="row"><h3>일일 퀘스트</h3><span class="sp"></span><span class="small">${doneN} / ${Q.length}</span></div>
  ${Q.map(q=>`<button type="button" class="q${q[2]?' on':''}" data-go="${q[3]}"><span class="box">${q[2]?'✓':''}</span><span class="qt">${q[0]}</span><span class="xpv">${q[1]?'+'+q[1]+'XP':''}</span></button>`).join('')}</div>
  <button class="btn ghost" type="button" id="hcopy">${sentLabel()}</button></div>`;
}
function cardioForm(){const c=log.cardio||{};return `<div class="cform"><div class="ctypes">${CARDIO.map(t=>`<button type="button" class="ct${(c.t||'수영')===t?' on':''}" data-t="${t}">${t}</button>`).join('')}</div>
  <div class="row"><input id="cmin" inputmode="numeric" placeholder="분" value="${esc(c.min||'40')}" aria-label="유산소 시간(분)"><span class="small">분</span><span class="sp"></span><button class="btn gold" type="button" id="csave" style="width:auto;padding:12px 18px">기록 +100XP</button></div></div>`}
function bindHome(v){
  const bd=document.getElementById('buddy');if(bd)bd.onclick=()=>{const x=totalXP(),lv=lvOf(x);poseI=poseI==null?1:(poseI+1)%POSES.length;bd.innerHTML=charSVG(Math.min(1,(lv-1)/29),poseI,prof().look)+`<span class="pose">${POSES[poseI].n}</span>`;bd.firstChild.classList.add('pop2')};
  const $=id=>document.getElementById(id);
  const toTrain=keys=>{session=keys;comboMode=keys.length>1;go('train')};
  if($('hstart'))$('hstart').onclick=()=>toTrain([nextDay()]);
  if($('hother'))$('hother').onclick=()=>{comboMode=false;go('train')};
  if($('hcombo'))$('hcombo').onclick=()=>{comboMode=true;session=[nextDay()];go('train');toast('같이 할 두 번째 부위를 고르세요')};
  if($('hcardio'))$('hcardio').onclick=()=>{homeMode=homeMode==='cardio'?'':'cardio';render(true)};
  if($('hcardio2'))$('hcardio2').onclick=()=>{homeMode=homeMode==='cardio'?'':'cardio';render(true)};
  if($('hpass'))$('hpass').onclick=()=>{log.pass=true;save();toast('오늘은 패스. 순서는 그대로 유지돼요');render(true)};
  if($('hundo'))$('hundo').onclick=()=>{delete log.pass;delete log.cardio;save();render(true)};
  if($('hclear'))$('hclear').onclick=()=>showClear(doneKeys(log),0);
  let ct=(log.cardio||{}).t||'수영';
  v.querySelectorAll('.ct').forEach(b=>b.onclick=()=>{ct=b.dataset.t;v.querySelectorAll('.ct').forEach(x=>x.classList.toggle('on',x===b))});
  if($('csave'))$('csave').onclick=()=>{const had=!!log.cardio;log.cardio={t:ct,min:$('cmin').value};delete log.pass;save();homeMode='';if(!had)toast('+100 XP · 유산소 완료');render(true)};
  v.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  $('hcopy').onclick=()=>finishDay();
}

/* ---------- TRAIN ---------- */
/* ---------- warm-up (foam roller · massage gun · band) ---------- */
function wuList(keys){const out=[],seen=new Set();keys.forEach(k=>(WU[k]||[]).forEach((w,j)=>{const id=k+j,key=w[0]+w[1];if(keys.length>1&&w[0]!=='워밍업 세트'&&seen.has(w[0]+w[1].slice(0,6)))return;seen.add(w[0]+w[1].slice(0,6));out.push({id,w})}));return out}
function warmCard(keys){const L=wuList(keys),d=log.wu||{},n=L.filter(x=>d[x.id]).length,all=n===L.length;
  return `<details class="panel wu"${all?'':' open'}><summary class="wus"><span>준비운동 · 약 7분</span><span class="small">${n} / ${L.length}${all?' ✓':''}</span></summary>
  ${L.map(({id,w})=>`<button type="button" class="q${d[id]?' on':''}" data-wu="${id}"><span class="box">${d[id]?'✓':''}</span><span class="qt"><em class="tool">${w[0]}</em>${esc(w[1])}</span><span class="xpv">${w[2]}</span></button>`).join('')}</details>`}
function renderTrain(){
  const keys=session,its=items(keys),[dn,tt]=prog(log,its),done=keys.every(k=>(log.done||{})[k]);
  const nx=nextDay();
  const chips=ORDER.map(x=>`<button type="button" role="tab" aria-selected="${keys.includes(x)}" data-day="${x}" style="--c:${col(x)}"><i></i>${DAYS[x].name}${x===nx?' · 차례':''}${cycle.done.includes(x)||(log.done||{})[x]?' <span class="ck">✓</span>':''}</button>`).join('');
  let html=`<div class="sec"><div class="row"><span class="eyebrow">${comboMode?'2부위 같이 · 두 개 고르기':'부위 고르기'}</span><span class="sp"></span><button type="button" class="toggle${comboMode?' on':''}" id="combo" aria-pressed="${comboMode}">2부위 같이</button></div>
  <div class="days" role="tablist">${chips}</div>
  <section class="hero" style="--c:${col(keys[0])}"><div class="row"><div style="flex:1;min-width:0"><span class="tag">${keys.map(k=>DAYS[k].tag).join(' + ')}</span><h2>${sname(keys)}</h2><p>${keys.length>1?'친구랑 모드: 부위별 메인 4종목씩 묶었어요. 두 부위 모두 완료 처리돼요.':keys[0]===nx?'순서대로 오늘 할 차례예요.':`순서와 다르게 해도 OK. 이걸 하면 체크되고, 다음엔 ${DAYS[nx].name}부터 이어서 해요.`}</p></div>${ring(tt?dn/tt:0,done?'✓':`${dn}/${tt}`)}</div></section>`;
  html+=warmCard(keys);
  its.forEach(({k,i,e},n)=>{
    const st=(log[k]&&log[k][i])||{sets:[],kg:''},sd=setsDone(log,k,i);e=effEx(k,i,e,st);const L=lastFor(k,i,e.n);
    html+=`<article class="ex${sd>=e.s?' complete':''}" data-k="${k}" data-i="${i}" style="--c:${col(k)}">
    <div class="top"><span class="num">${sd>=e.s?'✓':n+1}</span><div style="min-width:0"><h3>${esc(e.n)}</h3>${keys.length>1?`<span class="why">${DAYS[k].name}</span> `:''}${e.isNew&&!st.sw?`<span class="why" style="color:var(--ok)">NEW · 이번 사이클 </span>`:''}${e.coach&&!st.sw?`<span class="why" style="color:var(--ok)">트레이너 교체 </span>`:''}${e.why?`<span class="why">${esc(e.why)}</span>`:''}</div><span class="kg">${esc(e.kg)}<small>시작 무게</small></span></div>
    <div class="meta"><span><b>${e.s}×${esc(e.r)}</b></span><span>RIR <b>${esc(e.rir)}</b></span><span>휴식 <b>${esc(e.rest)}</b></span></div>
    ${(()=>{const rc=recommend(k,i,e);if(!L&&!rc)return '';return `<div class="last">${L?`지난번 ${md(L.d)} <b>${esc(L.kg)}</b> · ${L.n}세트`:''}${rc?`${L?' → ':''}오늘 추천 <b>${esc(fmtWR(rc.w,rc.r))}</b><br>${esc(rc.why)}`:''}</div>`})()}
    <div class="sets">${Array.from({length:e.s},(_,j)=>`<button type="button" class="s${st.sets[j]?' on':''}" data-j="${j}" aria-pressed="${!!st.sets[j]}" aria-label="${j+1}세트">${j+1}</button>`).join('')}
</div>
    ${(()=>{const [w,r]=wr(k,i,e,st,L);return `<button type="button" class="wr" aria-label="${esc(e.n)} 무게와 횟수 바꾸기"><span class="wl">무게</span><b>${w?w+'<small>kg</small>':'맨몸'}</b><span class="wx">×</span><b>${r}<small>회</small></b><span class="wh">눌러서 변경</span></button>`})()}
    <div class="exm"><button type="button" class="memob${st.memo?' has':''}" aria-expanded="false">✎ 메모${st.memo?' ·':''}</button><input class="memoin" id="exmemo-${k}-${i}" ${st.memo?'':'hidden'} placeholder="예) 3세트째 어깨 찌릿, 그립 좁게" value="${esc(st.memo||'')}"></div>
    <button type="button" class="altb">${st.sw?'원래 종목으로':'대체 운동으로'} <b>${esc(e.alt)}</b> <span>⇄</span></button>
    ${guideOf(e)?`<details><summary>자세 보기</summary><ul class="guide">${Object.entries(guideOf(e)).map(([a,b])=>`<li><span>${a}</span>${esc(b)}</li>`).join('')}</ul></details>`:''}
    </article>`;
  });
  html+=`<button class="btn ${done?'done':'gold'}" type="button" id="finish" style="padding:18px;font-size:17px">${done?'퀘스트 클리어 ✓ · 결과 다시 보기':`운동 완료 · 퀘스트 클리어 (${dn}/${tt})`}</button>
  <p class="small" style="text-align:center;margin:0">무게를 누르면 다이얼이 나와요. 돌려서 고르면 돼요. 세트를 체크하면 그 숫자로 자동 기록되고, 다음에 그대로 불러와요.</p></div>`;
  return html;
}
function bindTrain(v){
  v.querySelectorAll('[data-wu]').forEach(b=>b.onclick=()=>{log.wu=log.wu||{};const id=b.dataset.wu;log.wu[id]=!log.wu[id];save();render(true)});
  document.getElementById('combo').onclick=()=>{comboMode=!comboMode;if(!comboMode)session=[session[0]];else toast('같이 할 두 번째 부위를 고르세요');render(true)};
  v.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{const x=b.dataset.day;
    if(comboMode){if(session.includes(x)){if(session.length>1)session=session.filter(y=>y!==x)}else session=[session[session.length-1],x].slice(-2)}
    else session=[x];render(true)});
  v.querySelectorAll('.ex').forEach(art=>{
    const k=art.dataset.k,i=+art.dataset.i,e=effEx(k,i,DAYS[k].ex[i],(log[k]||{})[i]);
    const get=()=>{log[k]=log[k]||{};log[k][i]=log[k][i]||{sets:[],kg:''};return log[k][i]};
    const mb=art.querySelector('.memob'),mi=art.querySelector('.memoin');mb.onclick=()=>{mi.hidden=!mi.hidden;if(!mi.hidden)mi.focus()};mi.oninput=()=>{const st=get();st.memo=mi.value;save();mb.classList.toggle('has',!!mi.value)};
    art.querySelector('.altb').onclick=()=>{const st=get();st.sw=!st.sw;if(!(st.sets||[]).some(Boolean))st.kg='';st.n=st.sw?DAYS[k].ex[i].alt:DAYS[k].ex[i].n;save();toast(st.sw?'대체 운동으로 바꿨어요':'원래 종목으로 돌렸어요');render(true)};
    art.querySelectorAll('button.s').forEach(b=>b.onclick=()=>{
      const st=get(),j=+b.dataset.j;log.cn=log.cn||{};if(log.cn[k]==null)log.cn[k]=cycle.n;st.sets[j]=!st.sets[j];st.n=e.n;if(!st.kg){const [w,r]=wr(k,i,e,st,lastFor(k,i,e.n));st.kg=fmtWR(w,r)}save();
      if(st.sets[j]){const n=setsDone(log,k,i);toast(n>=e.s?'+30 XP · 종목 클리어':'+10 XP');startTimer(restSec(e.rest),e.n)}
      render(true);const nb=document.querySelector(`.ex[data-k="${k}"][data-i="${i}"] button.s[data-j="${j}"]`);if(nb&&st.sets[j])nb.classList.add('pop')});
    art.querySelector('.wr').onclick=()=>{const st=get();const [w,r]=wr(k,i,e,st,lastFor(k,i,e.n));
      openWheel(e.n,w,r,(nw,nr)=>{const st=get();st.kg=fmtWR(nw,nr);st.n=e.n;save();const bs=art.querySelectorAll('.wr b');bs[0].innerHTML=nw?nw+'<small>kg</small>':'맨몸';bs[1].innerHTML=nr+'<small>회</small>'})};
  });
  document.getElementById('finish').onclick=()=>{
    const keys=session,already=keys.every(k=>(log.done||{})[k]);
    const before=lvOf(totalXP());
    log.done=log.done||{};keys.forEach(k=>log.done[k]=true);delete log.pass;save();
    const wrapped=!already&&markDone(keys);queueSync(0);
    const after=lvOf(totalXP());
    showClear(keys,!already&&after>before?after:0,wrapped);
    render(true);
  };
}

/* ---------- clear overlay ---------- */
/* status line on the workout-complete screen, refreshed whenever a sync round finishes */
function paintClearSync(){const el=document.getElementById('csync');if(!el)return;
  const st=syncState==='ok'&&syncUnverified?['','시트로 보냈어요. 저장 확인은 못 했어요 (시트 코드 재배포가 필요할 수 있어요)']:syncState==='ok'?['ok','✓ 오늘 기록이 팀 시트에 저장됐어요']:syncState==='auth'?['ng','✗ 이름·PIN이 시트와 맞지 않아 저장 못 했어요. 내 정보에서 확인해 주세요']:syncState==='wait'?['ng','인터넷이 연결되면 자동으로 저장돼요. 기록은 폰에 있어요']:['','팀 시트에 저장 중...'];
  el.className='sendr '+st[0];el.textContent=st[1]}
function showClear(keys,lvUp,wrapped){
  clearInterval(tInt);document.getElementById('timer').hidden=true;
  const its=items(keys),[dn,tt]=prog(log,its);let vol=0;
  its.forEach(({k,i})=>{const st=log[k]&&log[k][i];const p=st&&parseKg(st.kg);if(p)vol+=p[0]*p[1]*setsDone(log,k,i)});
  const xp=dn*10+its.filter(({k,i,e})=>setsDone(log,k,i)>=e.s).length*20+200*keys.length;
  const o=document.getElementById('clear');o.hidden=false;
  o.innerHTML=`<canvas id="cf"></canvas><div class="box"><div class="badge"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
  <span class="eyebrow">${md(today)} · ${keys.map(k=>DAYS[k].tag).join(' + ')}</span><h1>Workout<br>Complete</h1><div class="sub">${sname(keys)} 완료. 오늘도 해냈어요. 다음은 ${DAYS[nextDay()].name}!</div>
  ${wrapped?`<span class="lvup" style="background:var(--ok)">CYCLE ${cycle.n} 완주 · 다음 사이클은 부위마다 종목 ${SWAPS_PER_CYCLE}개가 새로 바뀌어요</span>`:''}
  ${lvUp?`<span class="lvup">LEVEL UP · LV ${lvUp}${TITLES.some(t=>t[0]===lvUp)?' · 새 칭호 '+titleOf(lvUp):''}</span>`:''}
  <div class="stats"><div class="t"><small>세트</small><b>${dn}/${tt}</b></div><div class="t"><small>총 볼륨</small><b>${vol?Math.round(vol).toLocaleString():'-'}</b>${vol?'<em>kg</em>':''}</div><div class="t"><small>획득</small><b>+${xp}</b><em>XP</em></div></div>
  ${syncOn()?`<p class="sendr" id="csync"></p>`:''}
  <button class="btn gold" type="button" id="ccopy">${sentLabel()}</button><button class="btn ghost" type="button" id="cclose">닫기</button></div>`;
  document.getElementById('cclose').onclick=()=>{o.hidden=true;o.innerHTML=''};
  document.getElementById('ccopy').onclick=()=>finishDay();
  paintClearSync();confetti(document.getElementById('cf'));
}
function confetti(cv){
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const dpr=window.devicePixelRatio||1,ctx=cv.getContext('2d'),W=cv.width=cv.offsetWidth*dpr,H=cv.height=cv.offsetHeight*dpr;
  const cols=['#f5f5f2','#d7ff3a','#ff5b1f','#8e8e8a'];
  const P=Array.from({length:140},()=>({x:W/2,y:H*0.38,vx:(Math.random()-.5)*W*0.03,vy:-Math.random()*H*0.025-H*0.005,r:(Math.random()*6+4)*dpr,c:cols[Math.floor(Math.random()*cols.length)],a:Math.random()*6,va:(Math.random()-.5)*.3}));
  const t0=performance.now();
  (function f(t){ctx.clearRect(0,0,W,H);P.forEach(p=>{p.vy+=H*0.0006;p.vx*=.99;p.x+=p.vx;p.y+=p.vy;p.a+=p.va;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.c;ctx.fillRect(-p.r/2,-p.r/4,p.r,p.r/2);ctx.restore()});if(t-t0<3200&&cv.isConnected)requestAnimationFrame(f);else ctx.clearRect(0,0,W,H)})(t0);
}

/* ---------- FOOD ---------- */
function renderFood(){
  const [k,p]=totals(log),info=log.info||{};
  return `<div class="sec"><div><span class="eyebrow">Nutrition · 16:8</span><h2 style="font-size:28px">식단</h2></div>
  <div class="targets"><div class="t"><small>칼로리</small><b>${k.toLocaleString()}</b><em> / ${(+prof().kcal).toLocaleString()}kcal</em><div class="meter"><i style="width:${Math.min(100,k/prof().kcal*100)}%"></i></div></div>
  <div class="t"><small>단백질</small><b>${p}</b><em> / ${prof().prot}g</em><div class="meter p"><i style="width:${Math.min(100,p/prof().prot*100)}%"></i></div></div></div>
  <div class="panel"><h3>오늘 몸 상태</h3><div class="fields">${INFO.map(f=>`<label for="info-${f[0]}"><span>${f[1]}</span><input id="info-${f[0]}" data-f="${f[0]}" ${f[2]} placeholder="${f[3]}" value="${esc(info[f[0]]||'')}"></label>`).join('')}</div></div>
  ${MEALS.map(m=>`<div class="panel meal"><div class="mh"><h3>${m.t}</h3><span>${m.k}</span></div><p class="small" style="margin:0">${m.when}</p>
    ${m.o.length?(m.id?`<ul class="opts">${m.o.map((o,j)=>{const on=(log.meals||{})[m.id]===j;return `<li><button type="button" class="pick${on?' on':''}" data-m="${m.id}" data-j="${j}" aria-pressed="${on}"><b>${o[0]}</b> ${o[1]}<small>${o[2]}</small></button></li>`}).join('')}</ul><input class="memo" id="memo-${m.id}" data-m="${m.id}" placeholder="실제 메뉴·칼로리 (회사 앱 숫자 적기)" value="${esc((log.memo||{})[m.id]||'')}">`:`<ul class="opts static">${m.o.map(o=>`<li><b>${o[0]}</b> ${o[1]}<small>${o[2]}</small></li>`).join('')}</ul>`):''}</div>`).join('')}
  <div class="panel"><h3>외식·회식 규칙</h3><ul class="plain"><li>고기집: 삼겹살·항정살보다 목살, 소고기 안심, 오리. 공깃밥 반, 냉면·볶음밥 패스</li><li>국밥·찌개: 밥 1/3 덜고 국물 반만</li><li>치킨: 2~3조각, 양념보다 후라이드·구이</li><li>술: 주 1회 이내, 안주는 회·수육·두부</li></ul></div>
  <div class="panel"><h3>먹는 법</h3><ul class="plain"><li>오전 공복은 아메리카노·탄산수로. 힘들면 회사 단백질 1개를 오전으로 당겨도 OK</li><li>20:30 이후 배고프면 오이·방울토마토 조금은 괜찮아요</li><li>물 하루 2.5~3L</li><li>체중은 매일 아침 공복, 판단은 7일 평균</li></ul></div>
  <button class="btn gold" type="button" id="fcopy">${sentLabel()}</button></div>`;
}
function bindFood(v){
  v.querySelectorAll('.pick').forEach(b=>b.onclick=()=>{const m=b.dataset.m,j=+b.dataset.j;log.meals=log.meals||{};const was=log.meals[m]!==undefined&&log.meals[m]!==null;
    if(log.meals[m]===j){delete log.meals[m]}else{log.meals[m]=j;if(!was)toast('+30 XP · 식사 기록')}save();render(true)});
  v.querySelectorAll('.memo').forEach(i=>i.oninput=()=>{log.memo=log.memo||{};log.memo[i.dataset.m]=i.value;save()});
  v.querySelectorAll('.fields input').forEach(i=>{i.oninput=()=>{log.info=log.info||{};log.info[i.dataset.f]=i.value;save()};i.onchange=()=>renderHeader()});
  document.getElementById('fcopy').onclick=()=>finishDay();
}

/* ---------- LOG ---------- */
/* weekly report: charts come from the logs themselves, the written verdict from db doc pt/wk-<sunday> */
function wkSeries(){const ds=allDates().filter(d=>d<=today).sort().slice(-28);
  const w=ds.map(d=>{const v=+((lgOf(d).info||{}).w||0);return v?{d,v}:null}).filter(Boolean);
  const k=ds.slice(-7).map(d=>{const v=totals(lgOf(d))[0];return v?{d,v,t:+prof().kcal}:null}).filter(Boolean);
  const L=[['CH',0,'벤치'],['BK',0,'데드'],['LG',0,'스쿼트'],['SH',0,'OHP']].map(([k2,i,n])=>{const pts=ds.map(d=>{const st=(lgOf(d)[k2]||{})[i];const m=st&&String(st.kg||'').match(/^(\d+(?:\.\d+)?)/);return m?{d,v:+m[1]}:null}).filter(Boolean);return {n,pts}});
  return {w,k,L}}
function lineSVG(pts,unit){if(pts.length<2)return `<p class="small" style="margin:0">${pts.length?pts[0].v+unit+' (기록이 2일 이상 쌓이면 그래프가 그려져요)':'기록 없음'}</p>`;
  const W=320,H=120,px=28,py=16,vs=pts.map(p=>p.v),lo=Math.min(...vs)-.5,hi=Math.max(...vs)+.5;
  const x=i=>px+(W-px*2)*i/(pts.length-1),y=v=>py+(H-py*2)*(1-(v-lo)/(hi-lo||1));
  const path=pts.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(p.v).toFixed(1)).join(' ');
  return `<svg class="wkc" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="var(--sig)" stroke-width="2.2" stroke-linejoin="round"/>${pts.map((p,i)=>{const lab=pts.length<=8||i===0||i===pts.length-1||i%Math.ceil(pts.length/5)===0&&pts.length-1-i>=Math.ceil(pts.length/10);return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${pts.length>14?2.2:3.2}" fill="var(--bg)" stroke="var(--sig)" stroke-width="2"/>${lab?`<text x="${x(i).toFixed(1)}" y="${(y(p.v)-7).toFixed(1)}" text-anchor="middle">${p.v}</text><text x="${x(i).toFixed(1)}" y="${H-2}" text-anchor="middle" class="d">${md(p.d)}</text>`:''}`}).join('')}</svg>`}
function barSVG(pts){if(!pts.length)return '<p class="small" style="margin:0">식단을 기록하면 그려져요</p>';
  const W=320,H=120,px=14,py=16,mx=Math.max(...pts.map(p=>Math.max(p.v,p.t)))*1.1,bw=(W-px*2)/pts.length;
  const y=v=>py+(H-py*2)*(1-v/mx),t=pts[0].t;
  return `<svg class="wkc" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="${px}" x2="${W-px}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="var(--ok)" stroke-dasharray="4 4"/>${pts.map((p,i)=>`<rect x="${(px+bw*i+bw*.2).toFixed(1)}" y="${y(p.v).toFixed(1)}" width="${(bw*.6).toFixed(1)}" height="${(H-py-y(p.v)).toFixed(1)}" rx="2" fill="${p.v>p.t*1.1?'var(--sig)':'var(--ok)'}"/><text x="${(px+bw*i+bw/2).toFixed(1)}" y="${(y(p.v)-4).toFixed(1)}" text-anchor="middle">${(p.v/1000).toFixed(1)}k</text><text x="${(px+bw*i+bw/2).toFixed(1)}" y="${H-2}" text-anchor="middle" class="d">${md(p.d)}</text>`).join('')}</svg>`}
function wkCard(){const S=wkSeries();
  return `<div class="panel fb wk"><div class="row"><h3>주간 리포트</h3><span class="sp"></span><span class="small">최근 기록</span></div>
  <div class="fbs"><small>체중 (kg)</small>${lineSVG(S.w,'kg')}</div>
  <div class="fbs"><small>하루 섭취 (점선 = 목표 ${(+prof().kcal).toLocaleString()}kcal, 주황 = 초과)</small>${barSVG(S.k)}</div>
  <div class="fbs"><small>메인 운동 무게</small><ul>${S.L.map(l=>`<li>${l.n} ${l.pts.length?l.pts.map(p=>`<b>${p.v}</b><span class="dim">(${md(p.d)})</span>`).join(' → '):'<span class="dim">아직 기록 없음</span>'}</li>`).join('')}</ul></div></div>`}
function renderLog(){
  const ds=allDates().slice(0,21),m=monday();
  let kc=[],ws=[];
  for(let i=0;i<7;i++){const d=new Date(m);d.setDate(m.getDate()+i);const lg=lgOf(ymd(d));const t=totals(lg)[0];if(t)kc.push(t);if((lg.info||{}).w)ws.push(+lg.info.w)}
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
  return `<div class="sec"><div><span class="eyebrow">This week · ${md(ymd(m))}~</span><h2 style="font-size:28px">기록</h2></div>
  ${wkCard()}
  <div class="stats"><div class="t"><small>운동한 날</small><b>${weekCount()}/${WEEK_GOAL}</b></div><div class="t"><small>평균 섭취</small><b>${kc.length?Math.round(avg(kc)).toLocaleString():'-'}</b>${kc.length?'<em>kcal</em>':''}</div><div class="t"><small>평균 체중</small><b>${ws.length?avg(ws).toFixed(1):'-'}</b>${ws.length?'<em>kg</em>':''}</div></div>
  <div class="panel"><h3>날짜별 기록</h3><p class="small" style="margin:0">누르면 그날 기록이 복사돼요. 트레이너나 Claude에게 보내서 피드백 받기.</p><div class="hist">
  ${ds.map(d=>{const lg=lgOf(d);const [k,p]=totals(lg);const dk=doneKeys(lg);const wk=dk.length?dk.map(x=>DAYS[x].name).join('+'):lg.cardio?`유산소 ${lg.cardio.t}`:lg.pass?'패스':(workoutKey(lg).map(x=>DAYS[x].name+' 진행').join('·')||'운동 기록 없음');return `<button type="button" class="hrow" data-d="${d}"><b>${md(d)}${d===today?'<br><small style="color:var(--gold)">오늘</small>':''}</b><span>${wk}</span><span class="w">+${xpOf(lg)}XP</span><span class="s2">${k?k.toLocaleString()+'kcal · '+p+'g':'식단 없음'}${(lg.info||{}).w?' · '+lg.info.w+'kg':''}</span></button>`}).join('')}</div></div>
  <div class="panel"><h3>루틴 순서</h3>${cycleBar()}<ul class="plain"><li>요일 고정이 아니라 순서대로 돌아가요. 가슴 → 등 → 어깨 → 하체</li><li>3대 운동은 각 부위 날에: 벤치는 가슴, 데드는 등, 스쿼트는 하체</li><li>주 5번 운동이 목표. 나머지 2일은 쉬거나 수영</li><li>순서 건너뛰고 다른 부위 해도 OK. 안 한 부위가 다음 추천으로 남아요</li><li>한 바퀴 끝날 때마다 부위별 보조 종목 ${SWAPS_PER_CYCLE}개가 비슷한 종목으로 바뀌어요. 메인 운동은 그대로</li><li>지난 기록을 보고 오늘 무게를 추천해요: 모든 세트를 목표 횟수 상단까지 채우면 무게 올리기, 2번 연속 못 채우면 10% 낮추기</li></ul>
  <button class="btn ghost" type="button" id="reset" style="padding:10px;font-size:13px">순서 처음부터 다시 (가슴부터)</button></div>
  <div class="panel"><h3>규칙</h3><ul class="plain"><li>목표 반복 상단을 RIR 2로 채우면 상체 +1~2.5kg, 하체 +2.5~5kg</li><li>종목은 그대로 유지. 2주 정체 시 보조 종목만 교체</li><li>날카로운 통증·관절 통증·어지러움·가슴 통증·비정상적 호흡곤란이면 그날 운동 중단, 계속되면 병원</li></ul></div></div>`;
}
let resetArm=false;
function bindLog(v){
  v.querySelectorAll('.hrow').forEach(b=>b.onclick=()=>copyText(buildLog(b.dataset.d,lgOf(b.dataset.d))));
  const r=document.getElementById('reset');
  r.onclick=()=>{if(!resetArm){resetArm=true;r.textContent='한 번 더 누르면 초기화돼요';setTimeout(()=>{resetArm=false;if(r.isConnected)r.textContent='순서 처음부터 다시 (가슴부터)'},3000);return}
    resetArm=false;cycle.done=[];saveCycle();toast('순서를 가슴부터 다시 시작해요');render(true)};
}

/* ---------- character creator ---------- */
let draftLook=null,previewLv=1;
const GROW=[1,10,20,30];
function lookEditor(){const L=draftLook;
  const sw=(list,key,fn)=>list.map((v,i)=>`<button type="button" class="sw${L[key]===i?' on':''}" data-lk="${key}" data-v="${i}" style="background:${fn(v)}" aria-label="${key} ${i+1}"></button>`).join('');
  return `<div class="panel lk"><div class="row"><h3>내 캐릭터</h3><span class="sp"></span><span class="small">운동할수록 몸이 바뀌어요</span></div>
  <div class="lk-stage"><div class="lk-big" id="lkbig"></div><div class="lk-side">
    <span class="eyebrow">성장 미리보기</span><b class="lk-lv" id="lklvt"></b>
    <input type="range" min="1" max="30" value="${previewLv}" id="lklv" aria-label="미리볼 레벨">
    <p class="small" style="margin:0">밀어서 LV 30까지 어떻게 변하는지 보세요</p></div></div>
  <div class="grow" id="lkgrow"></div>
  <small class="lk-h">시작 체형 · 지금의 나와 비슷한 걸 골라요</small>
  <div class="bodies">${Object.entries(BODIES).map(([k,b])=>`<button type="button" class="bodyb${L.body===k?' on':''}" data-lk="body" data-v="${k}"><span class="bthumb">${charSVG(0,0,Object.assign({},L,{body:k}))}</span><span><b>${b.n}</b><small>${b.d}</small></span></button>`).join('')}</div>
  <small class="lk-h">머리 모양</small><div class="ctypes">${HAIRS.map(([k,n])=>`<button type="button" class="ct${L.hair===k?' on':''}" data-lk="hair" data-v="${k}">${n}</button>`).join('')}</div>
  <div class="lk-row"><div><small class="lk-h">피부</small><div class="sws">${sw(SKINS,'skin',v=>v[1])}</div></div><div><small class="lk-h">머리 색</small><div class="sws">${sw(HAIRC,'hairc',v=>v[0])}</div></div></div>
  <small class="lk-h">포인트 색 (머리띠·민소매)</small><div class="sws">${sw(ACCS,'acc',v=>v[1])}</div></div>`}
function paintLook(){const big=document.getElementById('lkbig');if(!big)return;const lv=previewLv,m=(lv-1)/29;
  big.innerHTML=charSVG(m,poseFor(lv),draftLook);document.getElementById('lklvt').textContent=`LV ${lv} · ${titleOf(lv)}`;
  document.getElementById('lkgrow').innerHTML=GROW.map(g=>`<button type="button" class="gr${g===lv?' on':''}" data-g="${g}">${charSVG((g-1)/29,poseFor(g),draftLook)}<span>LV ${g}<small>${titleOf(g)}</small></span></button>`).join('<i>›</i>');
  document.querySelectorAll('#lkgrow .gr').forEach(b=>b.onclick=()=>{previewLv=+b.dataset.g;document.getElementById('lklv').value=previewLv;paintLook()})}
function bindLook(){const box=document.querySelector('.lk');if(!box)return;
  box.querySelectorAll('[data-lk]').forEach(b=>b.onclick=()=>{const k=b.dataset.lk,v=b.dataset.v;draftLook[k]=k==='body'||k==='hair'?v:+v;
    box.querySelectorAll(`[data-lk="${k}"]`).forEach(x=>x.classList.toggle('on',x===b));
    if(k!=='body')box.querySelectorAll('.bodyb').forEach(x=>x.querySelector('.bthumb').innerHTML=charSVG(0,0,Object.assign({},draftLook,{body:x.dataset.v})));
    paintLook()});
  const r=document.getElementById('lklv');r.oninput=()=>{previewLv=+r.value;paintLook()};paintLook()}

/* ---------- SETTINGS (내 정보) ---------- */
function renderSet(){
  const p=prof(),first=!PROF;if(!draftLook)draftLook=lookOf(p.look);
  return `<div class="sec"><div><span class="eyebrow">${first?'Welcome':'Profile'}</span><h2 style="font-size:28px">${first?'처음 오셨네요':'내 정보'}</h2></div>
  ${first?lookEditor():''}
  ${first?`<p class="small" style="margin:0">이름과 1RM만 넣으면 종목별 시작 무게가 자동으로 계산돼요.${SYNC_URL?' 기록은 팀 시트에 자동 저장돼서 폰을 바꿔도 이름과 PIN으로 다시 불러올 수 있어요.':' 기록은 이 브라우저에만 저장돼요.'}</p>`:''}
  ${first&&SYNC_URL?`<div class="panel"><h3>이미 쓰던 기록이 있어요</h3><p class="small" style="margin:0">다른 폰이나 PC에서 쓰던 이름과 PIN을 넣으면 기록을 그대로 불러와요.</p>
  <div class="fields"><label for="r-name"><span>이름</span><input id="r-name" placeholder="예: 민수"></label><label for="r-pin"><span>PIN</span><input id="r-pin" inputmode="numeric" type="password" placeholder="숫자 4~8자리"></label></div>
  <button class="btn ghost" type="button" id="rload">기록 불러오기</button></div>`:''}
  <div class="panel"><h3>이름${SYNC_URL?' · PIN':''}</h3><div class="fields"${SYNC_URL?'':' style="grid-template-columns:1fr"'}><label for="s-name"><span>표시 이름</span><input id="s-name" placeholder="예: 민수" value="${esc(p.name||'')}"></label>${SYNC_URL?`<label for="s-pin"><span>PIN (숫자 4~8자리)</span><input id="s-pin" inputmode="numeric" type="password" placeholder="예: 1234" value="${esc(p.pin||'')}"></label>`:''}</div>
  ${SYNC_URL?'<p class="small" style="margin:0">이름과 PIN으로 팀 시트에 저장돼요. 다른 기기에서 기록을 불러올 때 필요하니 꼭 기억해 두세요. 이름이 다른 팀원과 겹치면 성까지 넣어주세요.</p>':''}</div>
  <div class="panel"><h3>1RM (1회 최대 무게)</h3><p class="small" style="margin:0">모르면 5회 겨우 드는 무게 × 1.15 정도로 넣으세요. 비워두면 그 부위 무게는 안 나와요.</p>
  <div class="fields">${LIFTS.map(([k,n])=>`<label for="s-${k}"><span>${n} (kg)</span><input id="s-${k}" inputmode="decimal" placeholder="예: 100" value="${esc((p.rm||{})[k]||'')}"></label>`).join('')}</div></div>
  <div class="panel"><h3>하루 목표</h3><div class="fields"><label for="s-kcal"><span>칼로리 (kcal)</span><input id="s-kcal" inputmode="numeric" value="${esc(p.kcal)}"></label><label for="s-prot"><span>단백질 (g)</span><input id="s-prot" inputmode="numeric" value="${esc(p.prot)}"></label></div></div>
  ${first?'':lookEditor()}
  <button class="btn gold" type="button" id="ssave">${first?'이 캐릭터로 시작하기':'저장'}</button>
  ${first?'':`<div class="panel"><h3>백업 · 기기 옮기기</h3><p class="small" style="margin:0">${SYNC_URL?'기록은 팀 시트에도 자동 저장돼요. 새 기기에서는 처음 화면의 "기록 불러오기"를 쓰면 돼요. 백업 파일은 혹시 몰라 따로 보관하고 싶을 때 쓰세요.':'기록은 이 브라우저에만 있어요. 폰을 바꾸거나 브라우저 데이터를 지우기 전에 백업 파일을 받아두세요.'}</p>
  <div class="row" style="gap:8px"><button class="btn ghost" type="button" id="sexp">백업 받기</button><button class="btn ghost" type="button" id="simp">백업 불러오기</button></div><input type="file" id="sfile" accept="application/json,.json" hidden></div>
  <button class="btn ghost" type="button" id="swipe" style="padding:10px;font-size:13px">이 기기의 내 기록 전부 지우기</button>`}</div>`;
}
let wipeArm=false;
function bindSet(){
  const $=id=>document.getElementById(id);bindLook();
  $('ssave').onclick=()=>{const num=v=>{const n=parseFloat(String(v).replace(',','.'));return n>0?n:''};
    const rm={};LIFTS.forEach(([k])=>rm[k]=num($('s-'+k).value));
    const name=$('s-name').value.trim(),pin=$('s-pin')?$('s-pin').value.trim():'';
    if(!name){toast('이름을 넣어 주세요');return}
    if(SYNC_URL&&!/^\d{4,8}$/.test(pin)){toast('PIN은 숫자 4~8자리로 정해 주세요');return}
    const old=PROF||{};
    PROF={name,pin,look:draftLook,rm,kcal:num($('s-kcal').value)||DEFAULT_TARGETS.kcal,prot:num($('s-prot').value)||DEFAULT_TARGETS.prot};
    store.set('pt-profile',PROF);
    /* new identity on the sheet: send everything this device already has */
    if(SYNC_URL&&(old.name!==name||old.pin!==pin))markAllPending();
    location.hash='';location.reload()};
  if($('rload'))$('rload').onclick=async()=>{const name=$('r-name').value.trim(),pin=$('r-pin').value.trim();
    if(!name||!/^\d{4,8}$/.test(pin)){toast('이름과 PIN을 확인해 주세요');return}
    const b=$('rload');b.disabled=true;b.textContent='불러오는 중...';
    try{const j=await syncPost({action:'load',name,pin});
      Object.entries(j.data||{}).forEach(([k,v])=>{if(!SYNC_RE.test(k))return;if(k==='pt-profile')v=Object.assign({},v,{name,pin});localStorage.setItem(k,JSON.stringify(v))});
      if(!(j.data||{})['pt-profile'])localStorage.setItem('pt-profile',JSON.stringify({name,pin,rm:{},kcal:DEFAULT_TARGETS.kcal,prot:DEFAULT_TARGETS.prot}));
      toast('기록을 불러왔어요');setTimeout(()=>{location.hash='';location.reload()},600)}
    catch(e){toast(e.message||'불러오지 못했어요');b.disabled=false;b.textContent='기록 불러오기'}};
  if(!$('sexp'))return;
  $('sexp').onclick=()=>{const out={app:'pt-routine',v:1,at:new Date().toISOString(),data:{}};
    try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('pt-'))out.data[k]=localStorage.getItem(k)}}catch(e){}
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out)],{type:'application/json'}));
    a.download=`pt-routine-${(PROF&&PROF.name)||'backup'}-${today}.json`;document.body.appendChild(a);a.click();a.remove();toast('백업 파일을 받았어요')};
  $('simp').onclick=()=>$('sfile').click();
  $('sfile').onchange=async()=>{const f=$('sfile').files[0];if(!f)return;
    try{const j=JSON.parse(await f.text());if(j.app!=='pt-routine'||!j.data)throw 0;
      Object.entries(j.data).forEach(([k,v])=>{if(k.startsWith('pt-'))localStorage.setItem(k,v)});toast('불러왔어요');setTimeout(()=>location.reload(),600)}
    catch(e){toast('이 앱의 백업 파일이 아니에요')}};
  $('swipe').onclick=()=>{const b=$('swipe');if(!wipeArm){wipeArm=true;b.textContent='한 번 더 누르면 전부 지워져요';setTimeout(()=>{wipeArm=false;if(b.isConnected)b.textContent='이 기기의 내 기록 전부 지우기'},3000);return}
    const ks=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('pt-'))ks.push(k)}ks.forEach(k=>localStorage.removeItem(k))}catch(e){}location.hash='';location.reload()};
}

/* ---------- render ---------- */
function render(keepScroll){
  const y=window.scrollY;
  renderHeader();renderTabs();
  const v=document.getElementById('view');
  if(view==='home'){v.innerHTML=renderHome();bindHome(v)}
  else if(view==='train'){v.innerHTML=renderTrain();bindTrain(v)}
  else if(view==='food'){v.innerHTML=renderFood();bindFood(v)}
  else if(view==='set'){v.innerHTML=renderSet();bindSet()}
  else {v.innerHTML=renderLog();bindLog(v)}
  if(keepScroll)window.scrollTo(0,y);
}
if(!PROF)view='set';
render();
queueSync(0);fetchCoach();
