'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],L='ABCDE',V={},S=['users','exams','students','results'];
const TY=[['mc','Multiple choice'],['tf','True / False'],['id','Identification'],['es','Essay']],TYN=Object.fromEntries(TY);
// Sheet templates (mm). q = quarter sheet (4 per 8.5x13 page, up to 60 items); h = half sheet (2 per page, up to 100 items)
const TPL={q:{W:100,H:156,mk:[[6,6],[94,6],[94,150],[6,150]],x0:7,cs:31,bx:9,bp:4.4,y0:61,rp:4.4,per:4},h:{W:208,H:157,mk:[[6,6],[202,6],[202,151],[6,151]],x0:10,cs:38,bx:9,bp:5,y0:62,rp:4.4,per:2}};
const lay=n=>n>60?'h':'q',
/* auto-fit: picks the number of columns that gives the biggest bubbles for this many items */
geo=n=>{const b=TPL[lay(n)],h=b.W>150,maxC=h?5:3,wav=h?192:91,top=b.y0,bot=b.y0+82;let best=null;
for(let c=1;c<=maxC;c++){const rows=Math.ceil(n/c);if(c>1&&(c-1)*rows>=n)continue;const rp=rows>1?Math.min(8,(bot-top)/(rows-1)):8,cs=wav/c,bd=Math.min(5.5,.8*rp,(cs-6.5)/7.2);if(!best||bd>best.bd+.01)best={rows,rp,cs,bd}}
const bd=+best.bd.toFixed(2),bp=Math.min(1.6*bd,(best.cs-6.5-2*bd)/4);return{...b,rows:best.rows,rp:best.rp,cs:best.cs,bd,bp,bx:4+1.5*bd}},
pos=(t,i,j)=>[t.x0+(i/t.rows|0)*t.cs+t.bx+j*t.bp,t.y0+i%t.rows*t.rp];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS=(k,d)=>localStorage.getItem(k)??d,uid=p=>p+Date.now().toString(36).slice(-4).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase();
let db,D={users:[],exams:[],students:[],results:[]},cur='',scan=null,stream=null,F={e:'',q:'',s:''},me=null,fh=null,pfh=null,tm,syTxt='',gyTxt='',IMG=null;
let AUTH=null,curV='dash',OPS=null,opT,cyTxt='';
/* ---------- IndexedDB (working store) ---------- */
const openDB=()=>new Promise((ok,no)=>{const r=indexedDB.open('omr-exam-v2',1);r.onupgradeneeded=()=>[...S,'meta'].forEach(s=>r.result.createObjectStore(s,s=='meta'?undefined:{keyPath:'id'}));r.onsuccess=()=>ok(db=r.result);r.onerror=()=>no(r.error)});
const tx=(s,m,f)=>new Promise((ok,no)=>{const t=db.transaction(s,m),q=f(t.objectStore(s));t.oncomplete=()=>ok(q&&q.result);t.onerror=()=>no(t.error)});
const all=s=>tx(s,'readonly',o=>o.getAll()),load=async()=>{for(const s of S)D[s]=await all(s)};
const put=async(s,v)=>{await tx(s,'readwrite',o=>o.put(v));await enqueue(s,{op:'put',id:String(v.id),rec:JSON.parse(JSON.stringify(v))});gsMark(s,v);sync()},del=async(s,id)=>{await tx(s,'readwrite',o=>o.delete(id));await enqueue(s,{op:'del',id:String(id)});sync()},clr=async s=>{await tx(s,'readwrite',o=>o.clear());await enqueue(s,{op:'clr'});sync()};
const meta=(k,v)=>v===undefined?tx('meta','readonly',o=>o.get(k)):tx('meta','readwrite',o=>o.put(v,k));
/* ---------- helpers ---------- */
const csv=t=>t.trim().split(/\r?\n/).map(l=>{const r=[];let c='',q=0;for(const ch of l){if(ch=='"')q=!q;else if(ch==','&&!q){r.push(c);c=''}else c+=ch}r.push(c);return r.map(x=>x.trim())});
const toCsv=rows=>rows.map(r=>r.map(v=>{v=String(v??'');if(/^[=+\-@]/.test(v))v="'"+v;return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(',')).join('\n');
const dl=(n,t,m='text/csv')=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:m}));a.download=n;a.click()};
const readF=f=>new Promise(r=>{const x=new FileReader();x.onload=()=>r(x.result);x.readAsText(f)});
const opts=(a,sel,fn)=>a.map(o=>`<option value="${esc(o.id)}"${o.id==sel?' selected':''}>${esc(fn(o))}</option>`).join('');
const adm=()=>me?.role=='admin',myEx=()=>D.exams.filter(e=>adm()||e.owner==me.id),ex=id=>myEx().find(e=>e.id==id),st=id=>D.students.find(s=>s.id==id);
const myRes=()=>{const ids=new Set(myEx().map(e=>e.id));return D.results.filter(r=>ids.has(r.examId))};
const grp=()=>{const g={};D.students.forEach(s=>(g[s.grade+'|'+s.sec]??=[]).push(s));return g},gname=k=>k.replace('|',' – ');
const inSec=(e,s)=>e.targets.includes(s.grade+'|'+s.sec);
const keyOK=e=>e.q.every(q=>q.t=='es'||q.t=='id'?(q.t=='es'||q.a.trim()!=''):q.t=='mc'?!!q.a&&L.includes(q.a):!!q.a&&'TF'.includes(q.a));
const same=(q,x)=>q.t=='id'?x.trim()!=''&&q.a.split('|').some(a=>a.trim().toLowerCase()==x.trim().toLowerCase()):x==q.a;
const grade=(e,f)=>{let c=0,w=0,b=0,a=0,s=0,t=0,pe=0;e.q.forEach((q,i)=>{const x=String(f[i]??'');t+=q.p;if(q.t=='es'){if(x==='')pe++;else s+=Math.min(q.p,Math.max(0,+x||0));return}if(x.trim()==='')b++;else if(x=='*')a++;else if(same(q,x)){c++;s+=q.p}else w++});const p=+(s/t*100).toFixed(2);return{correct:c,wrong:w,blank:b,amb:a,pend:pe,score:s,total:t,pct:p,pass:p>=e.pass}};
const stat=(t,bad)=>{syTxt=t;const e=$('#sy');if(e){e.textContent=t;e.className=bad?'bad':''}};
const gst=(t,bad)=>{gyTxt=t;const e=$('#gy');if(e){e.textContent=t;e.className=bad?'bad':''}};
/* ---------- Animated result pop-up ---------- */
const popKey=e=>{if(e.key=='Escape')closePop()};
function closePop(now){const o=$('#pop');if(!o)return;document.removeEventListener('keydown',popKey);if(now)return o.remove();o.classList.add('out');setTimeout(()=>o.remove(),220)}
function popup(html,cls=''){closePop(1);const o=document.createElement('div');o.id='pop';o.className='ov noprint';
o.innerHTML=`<div class="md ${cls}" role=dialog aria-modal=true aria-label="Scan result"><button class=x data-close aria-label=Close>×</button>${html}</div>`;
o.onclick=e=>{if(e.target==o||e.target.closest('[data-close]'))closePop()};document.body.appendChild(o);document.addEventListener('keydown',popKey);
const rm=matchMedia('(prefers-reduced-motion:reduce)').matches;
o.querySelectorAll('.fg').forEach(c=>requestAnimationFrame(()=>requestAnimationFrame(()=>c.style.strokeDashoffset=c.dataset.c*(1-Math.min(100,+c.dataset.p)/100))));
o.querySelectorAll('[data-n]').forEach(n=>{const t=+n.dataset.n,t0=performance.now(),fin=()=>n.textContent=+t.toFixed(1);if(rm)return fin();
const f=now=>{const k=Math.min(1,(now-t0)/1100);n.textContent=(t*(1-(1-k)**3)).toFixed(1);k<1?requestAnimationFrame(f):fin()};requestAnimationFrame(f)});
const b=o.querySelector('.md button:not(.x)')||o.querySelector('.x');b.focus();return o}
const CK='<svg viewBox="0 0 24 24"><path d="M5 13l4 4 10-10"/></svg>';
function resCard(e,sid,r,pre){const s=st(sid),C=2*Math.PI*52,bd=pre?(r.amb?'REVIEW NEEDED':'PRELIMINARY'):r.pass?'PASSED':'FAILED',bc=pre?'pre':r.pass?'ok':'no';
return`<h3>${esc(s?s.name:'Student not identified')}</h3><p class=sub>${esc(e.id)} · ${esc(e.title)}${s?' · '+esc(s.grade+' '+s.sec):''}</p>
<div class=rg><svg viewBox="0 0 120 120"><circle class=bg cx=60 cy=60 r=52 /><circle class="fg ${r.pass?'ok':'no'}" cx=60 cy=60 r=52 style="stroke-dasharray:${C};stroke-dashoffset:${C}" data-c="${C}" data-p="${r.pct}" /></svg><div class=num><b data-n="${r.pct}">0</b><span>%</span></div></div>
<p class=pts>${r.score} / ${r.total} points</p><div class="badge ${bc}">${bd}</div>
<div class=chips>${[['Correct',r.correct],['Wrong',r.wrong],['Blank',r.blank],['Ambiguous',r.amb]].map(([a,b],i)=>`<div class=chip style="animation-delay:${.55+i*.09}s"><b>${b}</b>${a}</div>`).join('')}</div>`}
/* ---------- Google Sheets (Apps Script web app) ---------- */
const GS_DEF='AKfycbz5D6iiLFRwSBhkf6UpQQNejeHHJr34N3Vx3AgMzEG0p_kbCbGWvRwMHCTPTmObGGcLbw';
const gsUrl=()=>{const v=(LS('gsId',GS_DEF)||'').trim();return!v?'':/^https?:/i.test(v)?v:'https://script.google.com/macros/s/'+v+'/exec'};
const gsOn=()=>LS('gsOn','1')=='1'&&!!gsUrl();
const marks=(e,f)=>e.q.map((q,i)=>{const x=String(f[i]??'');if(q.t=='es')return x===''?'p':'e';if(x.trim()==='')return'b';if(x=='*')return'a';return same(q,x)?'c':'w'});
function examPayload(e){const o=D.users.find(u=>u.id==e.owner)||{id:'',name:'Unknown teacher',email:''},keys=new Set(e.targets);
D.results.filter(r=>r.examId==e.id).forEach(r=>{const s=st(r.studentId);if(s)keys.add(s.grade+'|'+s.sec)});
return{action:'syncExam',token:LS('gsToken',''),auth:AUTH,teacher:{id:o.id,name:o.name,email:o.email},exam:{id:e.id,title:e.title,subject:e.subject,sy:e.sy,type:e.type,pass:e.pass,archived:!!e.archived,q:e.q.map(q=>({t:q.t,a:q.a,p:q.p}))},
sections:[...keys].sort().map(k=>{const[grade,sec]=k.split('|');return{grade,sec,students:D.students.filter(s=>s.grade==grade&&s.sec==sec).map(s=>{const r=D.results.find(x=>x.id==e.id+'|'+s.id);
return{id:s.id,sid:s.sid||'',name:s.name,res:r?{score:r.score,total:r.total,pct:r.pct,pass:!!r.pass,review:r.review,date:r.date.slice(0,16).replace('T',' '),attempts:1+(r.history||[]).length,final:r.final.map(String),mark:marks(e,r.final)}:null}})}})}}
async function gsPost(body){const u=gsUrl();let r;
try{r=await fetch(u,{method:'POST',body:JSON.stringify(body)})}
catch(x){if(!(x instanceof TypeError))throw x;await fetch(u,{method:'POST',mode:'no-cors',body:JSON.stringify(body)});return{ok:true,opaque:true,tabs:[]}}
let j;try{j=await r.json()}catch{throw new Error('Unexpected reply from Apps Script – deploy it as Web app with access "Anyone"')}
if(!j.ok)throw new Error(j.error||'Apps Script error');return j}
const gsQ=()=>{try{return new Set(JSON.parse(LS('gsDirty','[]')))}catch{return new Set}},gsSave=q=>localStorage.setItem('gsDirty',JSON.stringify([...q]));
let gsT,gsBusy=false,gsAgain=false;
function gsMark(s,v){if(!gsOn())return;const q=gsQ();
if(s=='results')q.add(v.examId);else if(s=='exams')q.add(v.id);else if(s=='students')D.exams.filter(e=>e.targets.includes(v.grade+'|'+v.sec)).forEach(e=>q.add(e.id));else return;
gsSave(q);clearTimeout(gsT);gsT=setTimeout(gsFlush,2000)}
async function gsFlush(){clearTimeout(gsT);if(!gsOn()||!AUTH)return{ok:true,n:0,tabs:[]};if(gsBusy){gsAgain=true;return{ok:true,n:0,tabs:[],busy:true}}
gsBusy=true;let n=0,err='',tabs=[];gst('Google Sheets: syncing…');
try{await load();for(const id of[...gsQ()]){const e=D.exams.find(x=>x.id==id),q=gsQ();if(!e){q.delete(id);gsSave(q);continue}
try{const j=await gsPost(examPayload(e));tabs=tabs.concat(j.tabs||[]);q.delete(id);gsSave(q);n++}catch(x){err=x.message||String(x);break}}}catch(x){err=x.message||String(x)}
gsBusy=false;const left=gsQ().size;
gst(err?'Google Sheets: '+err+(left?' ('+left+' waiting, will retry)':''):'Google Sheets synced '+new Date().toLocaleTimeString(),!!err);
if(gsAgain){gsAgain=false;setTimeout(gsFlush,300)}return{ok:!err,n,err,tabs}}
/* ---------- accounts ---------- */
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))),salt=()=>b64(crypto.getRandomValues(new Uint8Array(16))),GM=/^[a-z0-9._%+-]+@gmail\.com$/;
const hash=async(p,s)=>{const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(p),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(atob(s),c=>c.charCodeAt(0)),iterations:150000,hash:'SHA-256'},k,256))};
/* ---------- CLOUD DATABASE (Google Sheet via Code.gs): accounts + data shared by every browser/device ---------- */
const cst=(t,bad)=>{cyTxt=t;const e=$('#cy');if(e){e.textContent=t;e.className=bad?'bad':''}};
async function cpost(body){const u=gsUrl();if(!u)throw new Error('Cloud database URL is not set.');let r;
try{r=await fetch(u,{method:'POST',body:JSON.stringify(body)})}catch{const e=new Error('Cannot reach Google. Check your internet connection.');e.net=1;throw e}
let j;try{j=await r.json()}catch{throw new Error('Unexpected reply from Apps Script. Deploy Code.gs as a Web app (Execute as: Me, Who has access: Anyone) with a NEW version.')}
if(!j.ok)throw new Error(j.error||'Apps Script error');return j}
const opsLoad=async()=>{if(!OPS)OPS=(await meta('ops'))||[];return OPS},opsSave=()=>meta('ops',OPS);
async function enqueue(t,o){if(!AUTH)return;await opsLoad();o.t=t;o.by=AUTH.email;
if(o.op=='clr')OPS=OPS.filter(x=>!(x.t==t&&x.by==o.by));
else if(o.op=='del')OPS=OPS.filter(x=>!(x.t==t&&x.id==o.id&&x.by==o.by&&x.op!='clr'));
if(o.op=='put'){OPS=OPS.filter(x=>!(x.t==t&&x.id==o.id&&x.by==o.by&&x.op=='del'));const i=OPS.findIndex(x=>x.t==t&&x.id==o.id&&x.by==o.by&&x.op=='put');if(i>=0)OPS[i]=o;else OPS.push(o)}else OPS.push(o);
await opsSave();clearTimeout(opT);opT=setTimeout(()=>flushOps().catch(()=>{}),1500)}
let opP=Promise.resolve();const flushOps=()=>{const p=opP.then(doFlush);opP=p.catch(()=>{});return p};
async function doFlush(){clearTimeout(opT);if(!AUTH)return;await opsLoad();const b=OPS.filter(x=>x.by==AUTH.email);if(!b.length)return;cst('Cloud: saving…');
try{const j=await cpost({action:'push',auth:AUTH,ops:b.map(({by,...o})=>o)});OPS=OPS.filter(x=>!b.includes(x));await opsSave();
cst(j.denied?'Cloud: saved, but '+j.denied+' change(s) were not allowed':'Cloud saved '+new Date().toLocaleTimeString(),!!j.denied)}
catch(e){cst(e.net?'Cloud: offline – '+b.length+' change(s) waiting, will retry':'Cloud: '+e.message,1);throw e}}
async function replaceLocal(d){for(const t of S){const rs=d[t]||[];await tx(t,'readwrite',o=>{o.clear();rs.forEach(r=>o.put(r))})}}
async function cloudRefresh(){if(!AUTH)return;await flushOps();const j=await cpost({action:'pull',auth:AUTH});await replaceLocal(j.data);await load();cst('Cloud synced '+new Date().toLocaleTimeString())}
async function chPw(){const p=prompt('New password (min. 8 characters):');if(!p)return;if(p.length<8)return alert('Use at least 8 characters.');if(p!==prompt('Type the new password again:'))return alert('Passwords do not match.');
try{const sl=salt(),h=await hash(p,sl);await cpost({action:'chpw',auth:AUTH,salt:sl,hash:h});AUTH={email:AUTH.email,hash:h};sessionStorage.setItem('auth',JSON.stringify(AUTH));
const u=D.users.find(x=>x.id==me.id);if(u){u.salt=sl;u.hash=h;await tx('users','readwrite',o=>o.put(u))}alert('Password changed. Use it the next time you sign in.')}catch(e){alert('Could not change the password: '+e.message)}}
function authView(mode){if(!mode)mode='login';const reg=mode!='login';$('#nav').innerHTML='';
$('#m').innerHTML=`<div class=auth><h2>${{setup:'First-time setup: create the IT Admin account',login:'Sign in',signup:'Request an account'}[mode]}</h2><form id=lf>${reg?'<label>Full name<input name=name required></label>':''}<label>Gmail address<input name=email type=email required autocomplete=username></label><label>Password${reg?' (min. 8 characters)':''}<input name=pw type=password required${reg?' minlength=8':''}></label>${reg?'<label>Confirm password<input name=pw2 type=password required></label>':''}<button>${mode=='login'?'Sign in':'Submit'}</button></form><p id=am class=bad></p>${mode=='login'?'<p><a href=# id=sw>No account? Request one</a></p>':mode=='signup'?'<p><a href=# id=sw>Back to sign in</a></p>':''}<small>Accounts are stored in the school Google Sheet, so you can sign in from any browser or device. An IT administrator must approve every sign-up.</small></div>`;
const sw=$('#sw');if(sw)sw.onclick=e=>{e.preventDefault();authView(mode=='login'?'signup':'login')};
$('#lf').onsubmit=async ev=>{ev.preventDefault();const f=ev.target.elements,email=f.email.value.trim().toLowerCase(),say=t=>$('#am').textContent=t;
if(!crypto?.subtle)return say('Secure crypto unavailable: open this page through http://localhost.');
const bt=ev.target.querySelector('button');bt.disabled=true;say('Please wait…');
try{
if(reg){if(!GM.test(email))return say('Use a valid @gmail.com address.');if(f.pw.value!=f.pw2.value)return say('Passwords do not match.');
const sl=salt();await cpost({action:'signup',user:{id:uid('US-'),email,name:f.name.value.trim(),salt:sl,hash:await hash(f.pw.value,sl)}});
$('#lf').outerHTML='<p class=good>Request sent. You can sign in after the IT administrator approves it.</p>';return}
let au,off=0;
try{const sl=(await cpost({action:'salt',email})).salt;if(!sl)return say('Wrong email or password.');au={email,hash:await hash(f.pw.value,sl)};await cpost({action:'login',auth:au})}
catch(e){if(!e.net)return say(e.message);off=1}
if(off){const u=D.users.find(x=>x.email==email);if(!u||u.hash!=await hash(f.pw.value,u.salt))return say('Cannot reach Google, and this device has no saved copy of that account. Connect to the internet and try again.');if(u.status!='approved')return say('Your account is not approved.');au={email,hash:u.hash}}
AUTH=au;sessionStorage.setItem('auth',JSON.stringify(au));say('Loading your data…');
try{await cloudRefresh()}catch(e){if(!e.net)return say(e.message)}
const u=D.users.find(x=>x.email==email);if(!u)return say('Account data not found. Connect to the internet and try again.');enter(u)
}catch(e){say(e.message||String(e))}finally{bt.disabled=false}}}
function enter(u){me=u;sessionStorage.setItem('uid',u.id);go('dash')}
function buildNav(){const p=D.users.filter(u=>u.status=='pending').length;
$('#nav').innerHTML='<h1>Exam Scanner</h1>'+[['dash','Dashboard'],['exams','Exams'],['key','Questions &amp; Key'],['students','Students'],['sheet','Answer Sheets'],['scan','Scan Paper'],['results','Results'],...(adm()?[['users','Users'+(p?` (${p} pending)`:'')],['data','Database &amp; Settings']]:[])].map(([v,t])=>`<button data-v="${v}">${t}</button>`).join('')+`<small class=who>${esc(me.name)}<br>${esc(me.email)} · ${adm()?'IT Admin':'Teacher'}</small><small id=sy>${esc(syTxt)}</small><small id=gy>${esc(gyTxt)}</small><small id=cy>${esc(cyTxt)}</small><button id=rf>Refresh data</button><button id=cp>Change password</button><button id=lo>Sign out</button>`;
$$('#nav button[data-v]').forEach(b=>b.onclick=()=>go(b.dataset.v));$('#rf').onclick=async()=>{cst('Cloud: refreshing…');try{await cloudRefresh();go(curV)}catch(e){cst(e.net?'Cloud: offline':'Cloud: '+e.message,1)}};$('#cp').onclick=chPw;
$('#lo').onclick=async()=>{try{await flushOps()}catch{}sessionStorage.clear();AUTH=null;me=null;stopCam();authView()}}
const go=async v=>{if(v=='users'&&adm()&&AUTH){try{await cloudRefresh()}catch{}}await load();if(!me)return;curV=v;if(['users','data'].includes(v)&&!adm())v='dash';buildNav();$$('#nav button[data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v==v));stopCam();closePop(1);$('#m').innerHTML='';V[v]()};
V.users=()=>{const o={pending:0,approved:1,disabled:2,rejected:3},B=(id,a,t)=>`<button onclick="setU('${id}','${a}')">${t}</button> `;
$('#m').innerHTML=`<h2>Users</h2><p>Approve or reject sign-up requests. Ownership of the Gmail address is not verified automatically, so approve only staff you recognise.</p><table><tr><th>Name<th>Gmail<th>Role<th>Status<th>Requested<th></tr>${[...D.users].sort((a,b)=>o[a.status]-o[b.status]).map(u=>`<tr><td>${esc(u.name)}<td>${esc(u.email)}<td>${u.role=='admin'?'IT Admin':'Teacher'}<td class=${u.status=='approved'?'good':u.status=='pending'?'':'bad'}>${u.status}<td>${esc(u.created.slice(0,10))}<td>${u.status=='pending'?B(u.id,'approved','Approve')+B(u.id,'rejected','Reject'):u.id==me.id?'(you)':B(u.id,u.status=='approved'?'disabled':'approved',u.status=='approved'?'Disable':'Enable')+B(u.id,'role','Make '+(u.role=='admin'?'teacher':'IT admin'))+B(u.id,'pw','Reset password')+B(u.id,'del','Delete')}`).join('')}</table>`};
async function setU(id,a){const u=D.users.find(x=>x.id==id);if(!u||id==me.id)return;
if(a=='del'){if(!confirm('Delete account '+u.email+'? Their exams stay in the system.'))return;await del('users',id)}
else if(a=='role'){u.role=u.role=='admin'?'teacher':'admin';await put('users',u)}
else if(a=='pw'){const p=prompt('New temporary password for '+u.email+' (min. 8 characters):');if(!p||p.length<8)return;u.salt=salt();u.hash=await hash(p,u.salt);await put('users',u)}
else{u.status=a;await put('users',u)}go('users')}
/* ---------- Dashboard ---------- */
V.dash=()=>{const r=myRes(),av=r.length?(r.reduce((a,x)=>a+x.pct,0)/r.length).toFixed(1):'0';
$('#m').innerHTML=`<h2>Dashboard</h2><div class=cards>${[['Exams',myEx().length],['Students',D.students.length],['Sheets scanned',r.length],['Checked (confirmed)',r.filter(x=>x.review=='confirmed').length],['Average score',av+'%']].map(([a,b])=>`<div class=card><b>${b}</b>${a}</div>`).join('')}</div><p class=row>${[['exams','Create Exam'],['key','Questions & Key'],['students','Students'],['scan','Scan Exam Paper'],['results','View Results']].map(([v,t])=>`<button onclick="go('${v}')">${t}</button>`).join('')}</p><h3>Recent scanning activity</h3><table><tr><th>When<th>Exam<th>Student<th>Score<th>Review</tr>${[...r].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6).map(x=>`<tr><td>${esc(x.date.slice(0,16).replace('T',' '))}<td>${esc(x.examId)}<td>${esc(st(x.studentId)?.name||x.studentId)}<td>${x.pct}%<td>${esc(x.review)}`).join('')||'<tr><td colspan=5>No scans yet</tr>'}</table>`};
/* ---------- Exams ---------- */
V.exams=()=>{const g=grp(),ks=Object.keys(g).sort();
$('#m').innerHTML=`<h2>Exams</h2><form id=f class=grid><input type=hidden name=eid><label>Title<input name=title required></label><label>Subject<input name=subject required></label><label>School year<input name=sy placeholder=2026-2027 required></label><label>Exam type<input name=type placeholder=Quarterly required></label><label>Number of questions (1-100)<input name=n type=number min=1 max=100 value=50 required></label><label>Passing score (%)<input name=pass type=number min=0 max=100 value=75 required></label><label>Instructions (optional)<input name=instr></label>
<fieldset><legend>Students taking this exam (grade – section)</legend>${ks.map(k=>`<label class=chk><input type=checkbox name=tg value="${esc(k)}">${esc(gname(k))} (${g[k].length})</label>`).join('')||'<i>No students registered yet – ask the IT administrator to add them.</i>'}</fieldset><button>Save exam</button></form>
<p>Set each question's type (multiple choice, true/false, identification, essay) and answers under <b>Questions &amp; Key</b>.</p>
<table><tr><th>Exam ID<th>Title<th>Subject<th>Sections<th>Items / points<th>Pass<th>Key${adm()?'<th>Owner':''}<th></tr>${myEx().map(e=>`<tr><td>${esc(e.id)}<td>${esc(e.title)}${e.archived?' (archived)':''}<td>${esc(e.subject)}<td>${esc(e.targets.map(gname).join(', '))}<td>${e.q.length} / ${e.q.reduce((a,q)=>a+q.p,0)}<td>${e.pass}%<td>${keyOK(e)?'<span class=good>complete</span>':'<span class=bad>incomplete</span>'}${adm()?'<td>'+esc(D.users.find(u=>u.id==e.owner)?.name||'—'):''}<td><button onclick="editEx('${esc(e.id)}')">Edit</button> <button onclick="goKey('${esc(e.id)}')">Questions</button> <button onclick="arch('${esc(e.id)}')">${e.archived?'Restore':'Archive'}</button> <button onclick="delEx('${esc(e.id)}')">Delete</button>`).join('')}</table>`;
$('#f').onsubmit=async ev=>{ev.preventDefault();const f=ev.target.elements,old=ex(f.eid.value),n=+f.n.value,tg=$$('#f [name=tg]:checked').map(c=>c.value);
if(!tg.length)return alert('Select at least one grade & section.');if(old&&n<old.q.length&&!confirm('Reducing the number of questions removes the last questions from the key. Continue?'))return;
const e={id:old?.id||uid('EX-'),owner:old?.owner||me.id,created:old?.created||new Date().toISOString(),archived:old?.archived||false,pass:+f.pass.value,targets:tg,q:Array.from({length:n},(_,i)=>old?.q?.[i]||{t:'mc',a:'',p:1})};
['title','subject','sy','type','instr'].forEach(k=>e[k]=f[k].value.trim());await put('exams',e);go('exams')}};
function editEx(id){const e=ex(id),f=$('#f').elements;f.eid.value=e.id;['title','subject','sy','type','pass','instr'].forEach(k=>f[k].value=e[k]??'');f.n.value=e.q.length;$$('#f [name=tg]').forEach(c=>c.checked=e.targets.includes(c.value));scrollTo(0,0)}
function goKey(id){cur=id;go('key')}
async function arch(id){const e=ex(id);e.archived=!e.archived;await put('exams',e);go('exams')}
async function delEx(id){const e=ex(id);if(!e)return;const rs=D.results.filter(r=>r.examId==id);if(!confirm(`Delete exam ${id}?\n\nThis also PERMANENTLY deletes its questions, answer key and ${rs.length} scanned result(s) including attempt history. Student records are kept. This cannot be undone.`))return;for(const r of rs)await del('results',r.id);await del('exams',id);go('exams')}
/* ---------- Questions & answer key ---------- */
const TM={mc:'mc','multiple choice':'mc',tf:'tf','true/false':'tf','true or false':'tf',id:'id',identification:'id',es:'es',essay:'es'};
function parseQ(t,n,id){const m=[],errs=[];
try{let j=JSON.parse(t);if(j.examId&&j.examId!=id)errs.push('This file belongs to exam '+j.examId);if(j.questions)j=j.questions;(Array.isArray(j)?j:Object.entries(j).map(([k,v])=>({no:k,answer:v}))).forEach((x,i)=>m.push([+(x.no??x.question??i+1),x.type,x.answer,x.points]))}
catch{csv(t).forEach(r=>{if(/^\d+$/.test(r[0]))m.push(r.length>=3?[+r[0],r[1],r[2],r[3]]:[+r[0],'',r[1],''])})}
const q=Array.from({length:n},()=>({t:'mc',a:'',p:1})),seen={};
m.forEach(([k,ty,a,p])=>{a=String(a??'').trim();let t=TM[String(ty||'').trim().toLowerCase()];if(!(k>=1&&k<=n))return errs.push('Q'+k+' out of range');if(seen[k])return errs.push('Q'+k+' duplicated');seen[k]=1;
if(!t)t=a.length==1&&L.includes(a.toUpperCase())?'mc':/^(true|false)$/i.test(a)?'tf':a?'id':'es';
if(t=='mc'){a=a.toUpperCase();if(a.length!=1||!L.includes(a))errs.push('Q'+k+' invalid choice "'+a+'"')}
if(t=='tf'){a=(a[0]||'x').toUpperCase();if(!'TF'.includes(a))errs.push('Q'+k+' must be True or False');if(a=='x')a=''}
if(t=='id'&&!a)errs.push('Q'+k+' needs an answer');
q[k-1]={t,a:t=='es'?'':a,p:Math.max(1,+p||1)}});
const miss=[];for(let i=1;i<=n;i++)if(!seen[i])miss.push(i);if(miss.length)errs.push('missing: '+miss.join(','));return{q,errs}}
V.key=()=>{const es=myEx().filter(e=>!e.archived);if(!es.length){$('#m').innerHTML='<h2>Questions &amp; key</h2><p>Create an exam first.</p>';return}
if(!es.find(e=>e.id==cur))cur=es[0].id;const e=ex(cur);let q=e.q.map(x=>({...x}));
$('#m').innerHTML=`<h2>Questions &amp; key</h2><p class=row><select id=ke aria-label=Exam>${opts(es,cur,x=>x.id+' – '+x.title)}</select><label class=btn>Import CSV/JSON<input type=file id=kf accept=".csv,.json" hidden></label><button id=ks>Save</button><button id=kc>Export CSV</button><button id=kj>Export JSON</button></p><p id=kmsg>Identification: separate accepted answers with | . Essay: points = maximum score, graded by the teacher after scanning.</p><table id=kt></table>`;
const ctl=(x,i)=>x.t=='mc'?`<select data-a><option></option>${[...L].map(c=>`<option${c==x.a?' selected':''}>${c}</option>`).join('')}</select>`:x.t=='tf'?`<select data-a><option value=""></option>${['T','F'].map(c=>`<option value=${c}${c==x.a?' selected':''}>${c=='T'?'True':'False'}</option>`).join('')}</select>`:x.t=='id'?`<input data-a value="${esc(x.a)}" placeholder="answer | alternative">`:'<i>scored by teacher</i>';
const rd=()=>q=$$('#kt tr[data-i]').map(r=>{const a=r.querySelector('[data-a]');return{t:r.querySelector('[data-t]').value,a:a?a.value.trim():'',p:+r.querySelector('[data-p]').value||1}});
const draw=()=>{$('#kt').innerHTML='<tr><th>#<th>Type<th>Correct answer<th>Points</tr>'+q.map((x,i)=>`<tr data-i=${i}><td>${i+1}<td><select data-t>${TY.map(([v,n])=>`<option value=${v}${v==x.t?' selected':''}>${n}</option>`).join('')}</select><td>${ctl(x,i)}<td><input data-p type=number min=1 value=${x.p} style="width:70px">`).join('');
$$('#kt [data-t]').forEach(s=>s.onchange=()=>{rd();q[+s.closest('tr').dataset.i].a='';draw()})};draw();
$('#ke').onchange=x=>{cur=x.target.value;V.key()};
$('#kf').onchange=async x=>{const r=parseQ(await readF(x.target.files[0]),e.q.length,e.id);q=r.q;draw();$('#kmsg').innerHTML=r.errs.length?'<b class=bad>Issues found:</b> '+esc(r.errs.join('; ')):'<span class=good>Preview loaded.</span> Review it, then press Save.'};
$('#ks').onclick=async()=>{rd();const bad=q.flatMap((x,i)=>keyOK({q:[x]})?[]:[i+1]);if(bad.length)return alert('Answers missing or invalid for questions: '+bad.join(', '));e.q=q;await put('exams',e);alert('Saved for '+e.id)};
$('#kc').onclick=()=>{rd();dl(e.id+'-questions.csv',toCsv([['question','type','answer','points'],...q.map((x,i)=>[i+1,x.t,x.a,x.p])]))};
$('#kj').onclick=()=>{rd();dl(e.id+'-questions.json',JSON.stringify({examId:e.id,questions:q.map((x,i)=>({no:i+1,type:x.t,answer:x.a,points:x.p}))},null,1),'application/json')}};
/* ---------- Students (per grade & section) ---------- */
const newId=()=>{let i;do i=uid('ST-');while(st(i));return i};
V.students=()=>{const g=grp(),ks=Object.keys(g).sort(),a=adm();
$('#m').innerHTML=`<h2>Students by grade &amp; section</h2>${a?`<form id=f class=grid><label>Name<input name=name required></label><label>Grade<input name=grade required placeholder="Grade 7"></label><label>Section<input name=sec required></label><label>School ID (optional)<input name=sid></label><button>Register</button></form><p class=row><label class=btn>Import CSV (name,grade,section,schoolId)<input type=file id=sf accept=.csv hidden></label></p>`:'<p>Student records are managed by the IT administrator. Select their sections when you create an exam.</p>'}<p class=row><select id=fg aria-label=Filter><option value="">All grades &amp; sections</option>${ks.map(k=>`<option value="${esc(k)}">${esc(gname(k))}</option>`).join('')}</select><button id=sx>Export CSV</button></p><div id=sl></div>`;
const draw=()=>{const k=$('#fg').value;$('#sl').innerHTML=ks.filter(x=>!k||x==k).map(x=>`<h3>${esc(gname(x))} (${g[x].length})</h3><table><tr><th>Student ID<th>Name<th>School ID<th></tr>${g[x].map(s=>`<tr><td>${esc(s.id)}<td>${esc(s.name)}<td>${esc(s.sid)}<td>${a?`<button onclick="delSt('${esc(s.id)}')">Delete</button>`:''}`).join('')}</table>`).join('')||'<p>No students yet.</p>'};draw();$('#fg').onchange=draw;
if(a){const add=async(name,grade,sec,sid)=>{if(!name||!grade||!sec)return'missing field';if(sid&&D.students.some(s=>s.sid==sid))return'duplicate school ID '+sid;const s={id:newId(),name,grade,sec,sid:sid||''};D.students.push(s);await put('students',s)};
$('#f').onsubmit=async ev=>{ev.preventDefault();const f=ev.target.elements,r=await add(f.name.value.trim(),f.grade.value.trim(),f.sec.value.trim(),f.sid.value.trim());r?alert(r):go('students')};
$('#sf').onchange=async x=>{const rows=csv(await readF(x.target.files[0]));if(/^name$/i.test(rows[0][0]))rows.shift();const bad=[];let ok=0;for(const[i,r]of rows.entries()){const e=await add(r[0],r[1],r[2],r[3]);e?bad.push('row '+(i+1)+': '+e):ok++}alert(`Imported ${ok}. Skipped ${bad.length}.\n`+bad.join('\n'));go('students')}}
$('#sx').onclick=()=>dl('students.csv',toCsv([['Student ID','Name','Grade','Section','School ID'],...D.students.map(s=>[s.id,s.name,s.grade,s.sec,s.sid])]))};
async function delSt(id){if(confirm('Delete this student record? Saved exam results are kept.')){await del('students',id);go('students')}}
/* ---------- Printable answer sheets ---------- */
/* ---------- built-in QR code generator (byte mode, error correction M, versions 1-10) – no library needed ---------- */
function qrMake(text){
const data=[...new TextEncoder().encode(String(text))],ECC=[0,10,16,26,18,24,16,18,22,22,26],NB=[0,1,1,1,2,2,4,4,4,5,5];
const raw=v=>{let r=(16*v+128)*v+64;if(v>=2){const a=(v/7|0)+2;r-=(25*a-10)*a-55;if(v>=7)r-=36}return r};
let v=1;for(;v<=10;v++){if(4+8+8*data.length<=(raw(v)>>3)*8-ECC[v]*NB[v]*8)break}
if(v>10)throw new Error('QR data too long');
const cap=(raw(v)>>3)-ECC[v]*NB[v],bits=[],put=(x,n)=>{for(let i=n-1;i>=0;i--)bits.push((x>>>i)&1)};
put(4,4);put(data.length,8);data.forEach(b=>put(b,8));
for(let i=0;i<4&&bits.length<cap*8;i++)bits.push(0);while(bits.length%8)bits.push(0);
const cw=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=b<<1|bits[i+j];cw.push(b)}
for(let p=0xEC;cw.length<cap;p^=0xEC^0x11)cw.push(p);
const mul=(x,y)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x}return z};
const dv=n=>{const r=new Array(n).fill(0);r[n-1]=1;let rt=1;for(let i=0;i<n;i++){for(let j=0;j<n;j++){r[j]=mul(r[j],rt);if(j+1<n)r[j]^=r[j+1]}rt=mul(rt,2)}return r};
const rem=(d,div)=>{const r=new Array(div.length).fill(0);d.forEach(b=>{const f=b^r.shift();r.push(0);div.forEach((c,i)=>{r[i]^=mul(c,f)})});return r};
const nb=NB[v],el=ECC[v],rc=raw(v)>>3,ns=nb-rc%nb,sl=rc/nb|0,div=dv(el),blocks=[];
for(let i=0,k=0;i<nb;i++){const d=cw.slice(k,k+sl-el+(i<ns?0:1));k+=d.length;const e=rem(d,div);if(i<ns)d.push(0);blocks.push(d.concat(e))}
const all=[];for(let i=0;i<blocks[0].length;i++)blocks.forEach((b,j)=>{if(i!=sl-el||j>=ns)all.push(b[i])});
const n=v*4+17,M=Array.from({length:n},()=>new Array(n).fill(false)),FN=Array.from({length:n},()=>new Array(n).fill(false));
const set=(x,y,d)=>{M[y][x]=d;FN[y][x]=true};
for(let i=0;i<n;i++){set(6,i,i%2==0);set(i,6,i%2==0)}
const finder=(x,y)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy)),xx=x+dx,yy=y+dy;if(xx>=0&&xx<n&&yy>=0&&yy<n)set(xx,yy,d!=2&&d!=4)}};
finder(3,3);finder(n-4,3);finder(3,n-4);
if(v>1){const na=(v/7|0)+2,step=Math.ceil((v*4+4)/(na*2-2))*2,ap=[6];for(let p=n-7;ap.length<na;p-=step)ap.splice(1,0,p);
ap.forEach((cx,i)=>ap.forEach((cy,j)=>{if((i==0&&j==0)||(i==0&&j==na-1)||(i==na-1&&j==0))return;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(cx+dx,cy+dy,Math.max(Math.abs(dx),Math.abs(dy))!=1)}))}
const fmt=m=>{const d=m;let r=d;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);const b=((d<<10)|r)^0x5412,g=i=>((b>>>i)&1)!=0;
for(let i=0;i<=5;i++)set(8,i,g(i));set(8,7,g(6));set(8,8,g(7));set(7,8,g(8));for(let i=9;i<15;i++)set(14-i,8,g(i));
for(let i=0;i<8;i++)set(n-1-i,8,g(i));for(let i=8;i<15;i++)set(8,n-15+i,g(i));set(8,n-8,true)};
fmt(0);
if(v>=7){let r=v;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);const b=v<<12|r;for(let i=0;i<18;i++){const t=((b>>>i)&1)!=0,a=n-11+i%3,c=i/3|0;set(a,c,t);set(c,a,t)}}
for(let i=0,right=n-1;right>=1;right-=2){if(right==6)right=5;for(let vt=0;vt<n;vt++)for(let j=0;j<2;j++){const x=right-j,y=((right+1)&2)==0?n-1-vt:vt;if(!FN[y][x]&&i<all.length*8){M[y][x]=((all[i>>>3]>>>(7-(i&7)))&1)!=0;i++}}}
const mask=m=>{for(let y=0;y<n;y++)for(let x=0;x<n;x++){if(FN[y][x])continue;let q;switch(m){case 0:q=(x+y)%2==0;break;case 1:q=y%2==0;break;case 2:q=x%3==0;break;case 3:q=(x+y)%3==0;break;case 4:q=((x/3|0)+(y/2|0))%2==0;break;case 5:q=x*y%2+x*y%3==0;break;case 6:q=(x*y%2+x*y%3)%2==0;break;default:q=((x+y)%2+x*y%3)%2==0}if(q)M[y][x]=!M[y][x]}};
const pen=()=>{let p=0,dark=0;for(let a=0;a<n;a++){for(const row of[true,false]){let run=1;for(let b=1;b<n;b++){const c=row?M[a][b]:M[b][a],pr=row?M[a][b-1]:M[b-1][a];if(c==pr){run++;if(run==5)p+=3;else if(run>5)p++}else run=1}}}
for(let y=0;y<n;y++)for(let x=0;x<n;x++){if(M[y][x])dark++;if(x<n-1&&y<n-1&&M[y][x]==M[y][x+1]&&M[y][x]==M[y+1][x]&&M[y][x]==M[y+1][x+1])p+=3}
p+=(Math.ceil(Math.abs(dark*20-n*n*10)/(n*n))-1)*10;return p};
let best=0,bp=1e9;for(let m=0;m<8;m++){mask(m);fmt(m);const p=pen();if(p<bp){bp=p;best=m}mask(m)}
mask(best);fmt(best);
return{getModuleCount:()=>n,isDark:(r,c)=>M[r][c]}}
function qrSvg(q){const n=q.getModuleCount(),m=2,z=n+m*2;let d='';for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))d+=`M${c+m},${r+m}h1v1h-1z`;return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${z} ${z}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet"><rect width="${z}" height="${z}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`}
function sheet(e,s){const tp=geo(e.q.length),{W,H}=tp,box=(x,y,w,h,c)=>`<div class="a ${c}" style="left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm"></div>`,t=(x,y,w,txt,sz,b='')=>`<div class=a style="left:${x}mm;top:${y}mm;width:${w}mm;font-size:${sz}mm;${b}">${txt}</div>`;
let h=tp.mk.map(([x,y])=>box(x-2.5,y-2.5,5,5,'mk')).join('');
h+=(()=>{const aw=W-28,sc=String(LS('school','School Name')),ti=e.title+' – '+e.subject,fit=(tx,mx,cw,mn)=>Math.max(mn,Math.min(mx,aw/(Math.max(1,tx.length)*cw))),
tsz=fit(ti,3.2,.56,1.8),ssz=Math.max(1.4,Math.min(fit(sc,2.4,.62,1.4),tsz-.4)),one='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;';
return t(14,7.5,aw,esc(sc),ssz,'font-weight:700;text-align:center;'+one)+t(14,7.5+ssz*1.2+1.2,aw,esc(ti),tsz,'text-align:center;'+one)})()
+t(9,20,58,'Exam ID: '+esc(e.id)+'<br>Name: '+esc(s.name||'________________')+'<br>Grade/Sec: '+(s.id?esc(s.grade+' / '+s.sec):'________')+'<br>Date: ________',2.6,'line-height:1.55')
+t(9,45,W-18,'Shade ONE bubble per item completely with dark pencil or pen. '+esc(e.instr),2.1);
if(s.id){const q=qrMake(`EX:${e.id}|ST:${s.id}`);h+=`<div class=a style="left:${W-32}mm;top:18mm;width:24mm;height:24mm;background:#fff">${qrSvg(q)}</div>`+t(W-32,42,24,'Exam ID QR',1.8,'text-align:center')}
const bd=tp.bd,k=Math.min(1.6,bd/3.4),fs=2.7*k;
e.q.forEach((q,i)=>{const[x,y]=pos(tp,i,0);h+=t(x-bd/2-7.3,y-.52*fs,6,i+1,fs,'text-align:right');
if(i%tp.rows==0)for(let j=0;j<5;j++)h+=t(pos(tp,i,j)[0]-3,y-bd/2-2.4*k-2.1,6,L[j],2.4*k,'text-align:center');
if(q.t=='mc'||q.t=='tf')for(let j=0;j<(q.t=='mc'?5:2);j++)h+=box(pos(tp,i,j)[0]-bd/2,y-bd/2,bd,bd,'bb');
if(q.t=='tf')h+=t(x+2*tp.bp-bd/2,y-.6*1.7*k,tp.bp*3,'A=True B=False',1.7*k);
if(q.t=='id')h+=t(x-bd/2,y-1.07*1.5*k,tp.bp*5,'Ident.',1.5*k)+box(x+1.5*k,y+.35*bd,tp.bp*4+1,.3,'mk');
if(q.t=='es')h+=t(x-bd/2,y-.6*1.6*k,tp.bp*5,'Essay ('+q.p+' pt) – separate paper',1.6*k)});
return`<div class=sheet style="width:${W}mm;height:${H}mm">${h}</div>`}
V.sheet=()=>{const es=myEx().filter(e=>!e.archived);$('#m').innerHTML=`<h2>Answer sheets</h2><p class="row noprint"><select id=xe aria-label=Exam>${opts(es,cur,e=>e.id+' – '+e.title)}</select><select id=xs aria-label=Student></select><button id=xp>Preview</button><button onclick="print()">Print / Save as PDF</button></p><p class=noprint>Paper 8.5×13 in, scale 100%, margins None. Up to 60 items: 4 sheets per page. 61–100 items: 2 larger sheets per page. Cut on the dashed lines.</p><div id=sheets></div>`;
const fill=()=>{const e=ex($('#xe').value);$('#xs').innerHTML='<option value="">Blank sheet (no QR)</option><option value="*">All students of the selected sections</option>'+(e?opts(D.students.filter(s=>inSec(e,s)),'',s=>s.grade+' '+s.sec+' – '+s.name):'')};fill();$('#xe').onchange=fill;
$('#xp').onclick=()=>{try{const e=ex($('#xe').value);if(!e)return alert('Select an exam first');if(!keyOK(e)&&!confirm('This exam\'s key is incomplete. Print anyway?'))return;cur=e.id;const v=$('#xs').value,tp=geo(e.q.length),l=v=='*'?D.students.filter(s=>inSec(e,s)):[st(v)||{}],pg=[];
if(v=='*'){for(let i=0;i<l.length;i+=tp.per)pg.push(l.slice(i,i+tp.per))}else pg.push(Array(tp.per).fill(l[0]));
$('#sheets').innerHTML=pg.map(p=>`<div class="pg ${lay(e.q.length)=='h'?'h':''}">${p.map(s=>`<div class=cell>${sheet(e,s)}</div>`).join('')}</div>`).join('')||'<p>No students in those sections.</p>'}catch(err){console.error(err);$('#sheets').innerHTML='<p class=bad>Could not build the preview: '+esc(err.message)+'</p>'}}};
/* ---------- Camera ---------- */
function stopCam(){stream?.getTracks().forEach(t=>t.stop());stream=null}
async function startCam(id){if(!navigator.mediaDevices?.getUserMedia)return alert('Live camera unavailable here (needs http://localhost or HTTPS). Use "Upload image" instead.');stopCam();
try{stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},...(id?{deviceId:{exact:id}}:{})}});$('#vid').srcObject=stream;const ds=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind=='videoinput');$('#cams').innerHTML=ds.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||'Camera '+(i+1))}</option>`).join('')}catch(e){alert('Camera error: '+(e.name=='NotAllowedError'?'permission denied – allow camera access in the browser.':e.message))}}
function toCv(src,w,h){const s=Math.min(1,1600/Math.max(w,h)),c=$('#cv');c.width=w*s|0;c.height=h*s|0;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,c.width,c.height);IMG=x.getImageData(0,0,c.width,c.height)}
V.scan=()=>{$('#m').innerHTML=`<h2>Scan exam paper</h2><div class=row><select id=se aria-label="Exam (used if QR unreadable)">${opts(myEx().filter(e=>!e.archived),cur,e=>e.id+' – '+e.title)}</select><button id=cs>Start camera</button><select id=cams aria-label=Camera></select><button id=cp>Capture</button><label class=btn>Upload image<input id=up type=file accept="image/*" hidden></label><button id=pr>Scan &amp; process</button><button id=rs>Reset / Retake</button></div><p>Scan one cut sheet at a time, flat and upright, all 4 black corner squares visible. With the camera running, <b>Scan &amp; process</b> takes a fresh picture itself.</p><div class=two><video id=vid autoplay playsinline muted></video><canvas id=cv></canvas></div><div id=rv></div>`;
$('#cs').onclick=()=>startCam();$('#cams').onchange=e=>startCam(e.target.value);
$('#cp').onclick=()=>{const v=$('#vid');if(!v.videoWidth)return alert('Start the camera first.');toCv(v,v.videoWidth,v.videoHeight)};
$('#up').onchange=async e=>{try{stopCam();const b=await createImageBitmap(e.target.files[0]);toCv(b,b.width,b.height)}catch{alert('Could not read that image.')}};
$('#pr').onclick=processScan;$('#rs').onclick=()=>{scan=null;IMG=null;$('#cv').width=0;$('#rv').innerHTML='';closePop(1)}};
/* ---------- OMR ---------- */
function blobs(b,W,H){const seen=new Uint8Array(W*H),out=[],stk=[];for(let i=0;i<W*H;i++){if(!b[i]||seen[i])continue;let x0=W,y0=H,x1=0,y1=0,n=0,sx=0,sy=0;stk.push(i);seen[i]=1;
while(stk.length){const p=stk.pop(),x=p%W,y=(p-x)/W;n++;sx+=x;sy+=y;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;for(const q of[p-1,p+1,p-W,p+W])if(q>=0&&q<W*H&&b[q]&&!seen[q]&&Math.abs(q%W-x)<=1){seen[q]=1;stk.push(q)}}
out.push({w:x1-x0+1,h:y1-y0+1,n,x:sx/n,y:sy/n})}return out}
function homog(s,d){const A=[],B=[];for(let i=0;i<4;i++){const[x,y]=s[i],[u,v]=d[i];A.push([x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]);B.push(u,v)}
for(let i=0;i<8;i++){let m=i;for(let r=i+1;r<8;r++)if(Math.abs(A[r][i])>Math.abs(A[m][i]))m=r;[A[i],A[m]]=[A[m],A[i]];[B[i],B[m]]=[B[m],B[i]];for(let r=0;r<8;r++){if(r==i)continue;const f=A[r][i]/A[i][i];for(let c=i;c<8;c++)A[r][c]-=f*A[i][c];B[r]-=f*B[i]}}
const h=B.map((b,i)=>b/A[i][i]);return([x,y])=>{const w=h[6]*x+h[7]*y+1;return[(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w]}}
const fail=m=>{scan=null;$('#rv').innerHTML=`<p class=bad>${esc(m)}</p>`;popup(`<div class="ic err">!</div><h3>Scan failed</h3><p class=sub>${esc(m)}</p><p class=row style="justify-content:center"><button data-close>Close</button></p>`,'err')};
function processScan(){if(stream&&$('#vid').videoWidth){const v=$('#vid');toCv(v,v.videoWidth,v.videoHeight)}
if(!IMG)return fail('Capture or upload an image first.');$('#rv').innerHTML='<p>Processing…</p>';
setTimeout(()=>{try{scanImg(IMG)}catch(x){console.error(x);fail('Scan error: '+(x.message||x))}},30)}
/* find the 4 corner squares: they are the outermost solid squares on the sheet. Take extremes of all big solid blobs, widening the size cut-off until the geometry matches the sheet */
function quad(g,W,Hh,T,tp){const b=new Uint8Array(g.length);for(let i=0;i<g.length;i++)b[i]=g[i]<T?1:0;
const c=blobs(b,W,Hh).filter(o=>o.w>W*.01&&o.w<W*.12&&o.h>W*.01&&o.h<W*.12&&Math.abs(Math.log(o.w/o.h))<.5&&o.n/(o.w*o.h)>.6).sort((a,b)=>b.n-a.n);if(c.length<4)return null;
const dd=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),ratio=(tp.mk[3][1]-tp.mk[0][1])/(tp.mk[1][0]-tp.mk[0][0]);
for(const lv of[.6,.4,.25,.15,.08]){const grp=c.filter(o=>o.n>=c[0].n*lv);if(grp.length<4)continue;
const f=k=>grp.reduce((a,o)=>!a||k(o)<k(a)?o:a,null),m=[f(o=>o.x+o.y),f(o=>-(o.x-o.y)),f(o=>-(o.x+o.y)),f(o=>o.x-o.y)];if(new Set(m).size<4)continue;
const w=(dd(m[0],m[1])+dd(m[3],m[2]))/2,h=(dd(m[0],m[3])+dd(m[1],m[2]))/2;if(w<W*.2||Math.abs(Math.log(h/w/ratio))>.45)continue;return m}return null}
function scanImg({width:W,height:Hh,data:d}){const g=new Uint8Array(W*Hh),hist=Array(256).fill(0),warn=[];
for(let i=0;i<g.length;i++){const v=.299*d[4*i]+.587*d[4*i+1]+.114*d[4*i+2]|0;g[i]=v;hist[v]++}
let tot=g.length,sum=0,sb=0,wb=0,mx=0,T=128;hist.forEach((c,i)=>sum+=i*c);for(let i=0;i<256;i++){wb+=hist[i];const wf=tot-wb;if(!wb)continue;if(!wf)break;sb+=i*hist[i];const mb=sb/wb,mf=(sum-sb)/wf,v=wb*wf*(mb-mf)**2;if(v>mx){mx=v;T=i}}
let gr=0;for(let i=1;i<g.length;i+=3)gr+=Math.abs(g[i]-g[i-1]);if(gr/(g.length/3)<1.2)warn.push('Image looks blurry or low-contrast – consider retaking it.');
let qr=null;if(typeof jsQR=='function')try{qr=jsQR(d,W,Hh,{inversionAttempts:'dontInvert'})}catch{}else warn.push('QR reader (lib/jsQR.js) is not loaded – choose the exam above and the student below manually.');const m=qr&&/^EX:(.+)\|ST:(.+)$/.exec(qr.data);
let e=ex(m&&m[1]);if(m&&!e)warn.push('QR refers to an exam that is not yours or does not exist ('+m[1]+') – using the selected exam.');e=e||ex($('#se').value);
if(!e)return fail('Exam could not be identified. Select the exam above and rescan.');
if(!keyOK(e))return fail('Exam '+e.id+' has an incomplete key. Complete it under Questions & Key first.');
let sid=m&&m[2];if(!m)warn.push('Student ID QR unreadable – select the student manually.');else if(!st(sid)){warn.push('Unknown Student ID '+sid+' – select the student manually.');sid=''}else if(!inSec(e,st(sid)))warn.push('This student is not in the sections assigned to this exam.');
const tp=geo(e.q.length);let mk=null;for(const t of[T,T-20,T+20,T-40,T+40,T-60])if(mk=quad(g,W,Hh,Math.max(30,Math.min(230,t)),tp))break;
if(!mk)return fail('Alignment markers not found. Photograph the whole sheet flat, upright (not sideways), well lit, with all 4 black corner squares visible, then rescan.');
const P=homog(tp.mk,mk.map(o=>[o.x,o.y])),thr=+LS('thr',.5),det=[],stt=[],fills=[];
const px=(u,v)=>{u=Math.round(u);v=Math.round(v);return u<0||v<0||u>=W||v>=Hh?255:g[v*W+u]},at=(x,y)=>{const[u,v]=P([x,y]);return px(u,v)};
e.q.forEach((q,i)=>{if(q.t=='id'||q.t=='es'){det.push('');stt.push('manual');fills.push([]);return}
const nb=q.t=='mc'?5:2,sym=j=>q.t=='mc'?L[j]:'TF'[j],f=[];
for(let j=0;j<nb;j++){const[cx,cy]=pos(tp,i,j),rg=[];for(let a=0;a<8;a++)rg.push(at(cx+(tp.bd/2+.45)*Math.cos(a*Math.PI/4),cy+(tp.bd/2+.45)*Math.sin(a*Math.PI/4)));rg.sort((p,r)=>p-r);
const cut=Math.max(rg[5],60)*.8;let k=0,n=0;const kk=tp.bd/3.4;for(let dx=-1.2*kk;dx<=1.2*kk+1e-9;dx+=.4*kk)for(let dy=-1.2*kk;dy<=1.2*kk+1e-9;dy+=.4*kk){if(dx*dx+dy*dy>1.2*kk*kk)continue;n++;if(at(cx+dx,cy+dy)<cut)k++}f.push(k/n)}
const hit=f.flatMap((v,j)=>v>=thr?[j]:[]);let a,s;if(hit.length==1){a=sym(hit[0]);s='ok'}else if(hit.length>1){a='*';s='multiple'}else if(Math.max(...f)>=thr*.55){a='*';s='uncertain'}else{a='';s='blank'}det.push(a);stt.push(s);fills.push(f)});
/* draw what was detected on the picture: red = corner squares, green = answers read, orange = doubtful */
const cx=$('#cv').getContext('2d');cx.putImageData(IMG,0,0);cx.lineWidth=Math.max(2,W/400);cx.strokeStyle='#e00';mk.forEach(o=>cx.strokeRect(o.x-o.w/2,o.y-o.h/2,o.w,o.h));
e.q.forEach((q,i)=>fills[i].forEach((v,j)=>{if(v<thr*.55)return;const[x,y]=pos(tp,i,j),[u,w]=P([x,y]),[u2,w2]=P([x+tp.bd/2,y]);cx.strokeStyle=stt[i]=='ok'?'#17b35a':'#ff9800';cx.beginPath();cx.arc(u,w,Math.hypot(u2-u,w2-w),0,7);cx.stroke()}));
scan={det,stt,fills,eid:e.id,sid,warn};review();
const r=grade(e,det),pre=e.q.some(q=>q.t=='id'||q.t=='es');
popup(`<div class="ic ok">${CK}</div>${resCard(e,sid,r,1)}${warn.map(w=>`<div class=w>${esc(w)}</div>`).join('')}${pre?'<p class=note>Preliminary score: identification answers and essay scores still need your input.</p>':''}${!sid?'<p class=note>Select the student in the review list below.</p>':''}<p class=row style="justify-content:center"><button data-close>Review &amp; edit answers</button></p>`)}
function review(){const e=ex(scan.eid);
const ctl=(q,i,a)=>q.t=='id'?`<input data-q=${i} value="${esc(a)}" placeholder="type the written answer">`:q.t=='es'?`<input data-q=${i} type=number min=0 max=${q.p} step=.5 value="${esc(a)}" placeholder="score /${q.p}">`:`<select data-q=${i}><option value="">blank</option>${(q.t=='mc'?[...L]:['T','F']).map(c=>`<option value=${c}${c==a?' selected':''}>${q.t=='tf'?(c=='T'?'True':'False'):c}</option>`).join('')}<option value="*"${a=='*'?' selected':''}>⚠ ambiguous</option></select>`;
$('#rv').innerHTML=`${scan.warn.map(w=>`<p class=bad>${esc(w)}</p>`).join('')}<h3>Review – ${esc(e.id)} ${esc(e.title)}</h3><p class=row><label>Student <select id=ss><option value="">— select —</option>${opts(D.students.filter(s=>inSec(e,s)||s.id==scan.sid),scan.sid,x=>x.grade+' '+x.sec+' – '+x.name+' ('+x.id+')')}</select></label></p><div id=sum></div>
<table><tr><th>Q<th>Type<th>Key<th>Answer (editable)<th>Detection<th>Fill % (A–E / T,F)</tr>${scan.det.map((a,i)=>{const q=e.q[i];return`<tr class="${scan.stt[i]}"><td>${i+1}<td>${TYN[q.t]}<td>${q.t=='es'?'max '+q.p:esc(q.a)}<td>${ctl(q,i,a)}<td>${scan.stt[i]}<td>${scan.fills[i].map(v=>Math.round(v*100)).join(' / ')}`}).join('')}</table><p>Identification answers and essay scores are entered by you (read them from the image above).</p><p><button id=sv>Confirm &amp; save result</button></p>`;
const vals=()=>$$('#rv [data-q]').map(s=>s.value),upd=()=>{const f=vals(),r=grade(e,f),ch=f.filter((x,i)=>x!=scan.det[i]).length;$('#sum').innerHTML=`<p><b>${r.score}/${r.total} pts (${r.pct}%) – <span class=${r.pass?'good':'bad'}>${r.pass?'PASSED':'FAILED'}</span></b> · correct ${r.correct} · wrong ${r.wrong} · blank ${r.blank} · ambiguous ${r.amb} (not counted) · essays unscored ${r.pend} · teacher-entered/edited ${ch}</p>`};
$$('#rv [data-q]').forEach(s=>s.oninput=upd);upd();$('#sv').onclick=()=>saveScan(e,vals())}
async function saveScan(e,f){const s=$('#ss').value;if(!s)return alert('Select the student before saving.');const id=e.id+'|'+s,old=D.results.find(r=>r.id==id);
if(old&&!confirm('This student already has a result for this exam. Replace it? The previous attempt is kept in the history.'))return;
const gr=grade(e,f),rec={id,examId:e.id,studentId:s,detected:scan.det,final:f,corrected:f.flatMap((x,i)=>x!=scan.det[i]?[i+1]:[]),...gr,date:new Date().toISOString(),review:f.includes('*')||gr.pend?'flagged':'confirmed',history:old?[...(old.history||[]),{...old,history:undefined}]:[]};
await put('results',rec);scan=null;await load();$('#rv').innerHTML='<p class=good>Result saved.</p>';
popup(`<div class="ic ok">${CK}</div><p class=sub style="margin:10px 0 0">Result saved</p>${resCard(e,s,gr,0)}<p id=gsm class=gs>${gsOn()?'☁ Sending to Google Sheets…':''}</p><p class=row style="justify-content:center"><button data-close id=nx>Scan next</button> <button class=alt data-close>Close</button></p>`);
$('#nx').onclick=()=>{IMG=null;$('#cv').width=0;$('#rv').innerHTML=''};
if(gsOn())gsFlush().then(x=>{const m=$('#gsm');if(!m)return;m.className='gs '+(x.ok?'good':'bad');m.textContent=x.ok?(x.busy?'☁ Sync queued – will upload shortly':'☁ Saved to Google Sheets'+(x.tabs.length?': '+x.tabs.join(', '):'')):'☁ Not uploaded yet ('+x.err+') – saved here, will retry automatically'})}
/* ---------- Results ---------- */
V.results=()=>{const rs=myRes().filter(r=>(!F.e||r.examId==F.e)&&(!F.s||r.review==F.s)&&(!F.q||((st(r.studentId)?.name||'')+r.studentId).toLowerCase().includes(F.q.toLowerCase())));
const sc=rs.map(r=>r.pct),stats=sc.length?`<div class=cards>${[['Students',sc.length],['Highest',Math.max(...sc)+'%'],['Lowest',Math.min(...sc)+'%'],['Average',(sc.reduce((a,b)=>a+b,0)/sc.length).toFixed(1)+'%'],['Passing rate',Math.round(rs.filter(r=>r.pass).length/sc.length*100)+'%'],['Flagged',rs.filter(r=>r.review=='flagged').length]].map(([a,b])=>`<div class=card><b>${b}</b>${a}</div>`).join('')}</div>`:'';
$('#m').innerHTML=`<h2>Results</h2><p class=row><select id=fe aria-label=Exam><option value="">All exams</option>${opts(myEx(),F.e,e=>e.id+' – '+e.title)}</select><input id=fq placeholder="Search student" value="${esc(F.q)}"><select id=fs aria-label=Status><option value="">Any status</option><option${F.s=='flagged'?' selected':''}>flagged</option><option${F.s=='confirmed'?' selected':''}>confirmed</option></select><button id=fx>Export CSV</button></p>${stats}
<table><tr><th>Exam ID<th>Name<th>Grade/Sec<th>Correct<th>Wrong<th>Blank<th>Ambig.<th>Score<th>%<th>Status<th>Scanned<th>Review<th>Attempts</tr>${rs.map(r=>{const s=st(r.studentId)||{};return`<tr><td>${esc(r.examId)}<td>${esc(s.name||'(deleted)')}<td>${esc((s.grade||'')+' / '+(s.sec||''))}<td>${r.correct}<td>${r.wrong}<td>${r.blank}<td>${r.amb}<td>${r.score}/${r.total}<td>${r.pct}<td class=${r.pass?'good':'bad'}>${r.pass?'PASSED':'FAILED'}<td>${esc(r.date.slice(0,16).replace('T',' '))}<td>${esc(r.review)}<td>${r.history.length+1}`}).join('')||'<tr><td colspan=13>No results</tr>'}</table>`;
$('#fe').onchange=e=>{F.e=e.target.value;V.results()};$('#fq').onchange=e=>{F.q=e.target.value;V.results()};$('#fs').onchange=e=>{F.s=e.target.value;V.results()};
$('#fx').onclick=()=>dl('results.csv',toCsv([['Exam ID','Exam','Name','Grade','Section','Correct','Wrong','Blank','Ambiguous','Score','Total points','Percent','Status','Scanned','Review'],...rs.map(r=>{const s=st(r.studentId)||{};return[r.examId,D.exams.find(e=>e.id==r.examId)?.title||'',s.name||'',s.grade||'',s.sec||'',r.correct,r.wrong,r.blank,r.amb,r.score,r.total,r.pct,r.pass?'PASSED':'FAILED',r.date,r.review]})]))};
/* ---------- Spreadsheet database (.xlsx) ---------- */
function toWb(){const wb=XLSX.utils.book_new(),add=(n,r)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(r),n),att=r=>[...(r.history||[]),r];
add('Users',D.users.map(u=>({id:u.id,email:u.email,name:u.name,role:u.role,status:u.status,salt:u.salt,hash:u.hash,created:u.created})));
add('Students',D.students.map(s=>({id:s.id,name:s.name,grade:s.grade,section:s.sec,schoolId:s.sid})));
add('Exams',D.exams.map(e=>({id:e.id,owner:e.owner,title:e.title,subject:e.subject,schoolYear:e.sy,type:e.type,passing:e.pass,targets:e.targets.join(';'),archived:e.archived?1:0,created:e.created,instructions:e.instr})));
add('Questions',D.exams.flatMap(e=>e.q.map((q,i)=>({examId:e.id,no:i+1,type:q.t,answer:q.a,points:q.p}))));
add('Results',D.results.flatMap(r=>att(r).map((x,k,a)=>({examId:r.examId,studentId:r.studentId,attempt:k+1,current:k==a.length-1?1:0,date:x.date,score:x.score,total:x.total,percent:x.pct,passed:x.pass?1:0,review:x.review,correct:x.correct,wrong:x.wrong,blank:x.blank,ambiguous:x.amb}))));
add('Answers',D.results.flatMap(r=>att(r).flatMap((x,k)=>x.final.map((f,i)=>({examId:r.examId,studentId:r.studentId,attempt:k+1,no:i+1,detected:x.detected[i],final:f})))));return wb}
function fromWb(wb){const g=n=>{if(!wb.Sheets[n])throw new Error('missing sheet '+n);return XLSX.utils.sheet_to_json(wb.Sheets[n],{defval:''})},s=x=>String(x??''),n=x=>+x||0;
const qs=g('Questions'),an=g('Answers'),R={users:g('Users').map(u=>({id:s(u.id),email:s(u.email),name:s(u.name),role:s(u.role),status:s(u.status),salt:s(u.salt),hash:s(u.hash),created:s(u.created)})),
students:g('Students').map(x=>({id:s(x.id),name:s(x.name),grade:s(x.grade),sec:s(x.section),sid:s(x.schoolId)})),
exams:g('Exams').map(x=>({id:s(x.id),owner:s(x.owner),title:s(x.title),subject:s(x.subject),sy:s(x.schoolYear),type:s(x.type),pass:n(x.passing),targets:s(x.targets).split(';').filter(Boolean),archived:!!n(x.archived),created:s(x.created),instr:s(x.instructions),q:qs.filter(q=>q.examId==x.id).sort((a,b)=>a.no-b.no).map(q=>({t:s(q.type),a:s(q.answer),p:n(q.points)||1}))})),results:[]};
const grp={};g('Results').forEach(r=>(grp[r.examId+'|'+r.studentId]??=[]).push(r));
for(const k in grp){const at=grp[k].sort((a,b)=>a.attempt-b.attempt).map(r=>{const a=an.filter(y=>y.examId==r.examId&&y.studentId==r.studentId&&y.attempt==r.attempt).sort((x,y)=>x.no-y.no),f=a.map(y=>s(y.final)),d=a.map(y=>s(y.detected));
return{id:k,examId:s(r.examId),studentId:s(r.studentId),detected:d,final:f,corrected:f.flatMap((x,i)=>x!=d[i]?[i+1]:[]),correct:n(r.correct),wrong:n(r.wrong),blank:n(r.blank),amb:n(r.ambiguous),pend:0,score:n(r.score),total:n(r.total),pct:n(r.percent),pass:!!n(r.passed),date:s(r.date),review:s(r.review),history:[]}});const last=at.pop();last.history=at;R.results.push(last)}
if(!R.users.some(u=>u.role=='admin'&&u.status=='approved'&&u.hash))throw new Error('no approved IT admin account');
if(R.users.some(u=>!u.id||!u.email)||R.students.some(x=>!x.id||!x.name)||R.exams.some(e=>!e.id||!e.q.length||e.q.length>100||!e.targets.length))throw new Error('invalid users, students or exams');
if(R.results.some(r=>!R.exams.some(e=>e.id==r.examId)))throw new Error('results refer to an unknown exam');return R}
async function applyWb(wb){let R;try{R=fromWb(wb)}catch(e){alert('Invalid database file: '+e.message);return}
if(!confirm(`Replace ALL current data with ${R.users.length} users, ${R.students.length} students, ${R.exams.length} exams and ${R.results.length} results from this file?`))return;
for(const t of S){await clr(t);for(const r of R[t])await put(t,r)}await load();me=D.users.find(u=>u.id==me.id&&u.role=='admin'&&u.status=='approved')||null;if(!me){sessionStorage.clear();location.reload()}return true}
function sync(){if(!fh)return;clearTimeout(tm);tm=setTimeout(saveXlsx,1200)}
async function saveXlsx(){if(!fh)return;try{await load();const w=await fh.createWritable();await w.write(XLSX.write(toWb(),{type:'array',bookType:'xlsx'}));await w.close();stat('Spreadsheet saved '+new Date().toLocaleTimeString())}catch(e){stat('Spreadsheet save failed: '+e.message,1)}}
const XT=[{description:'Excel workbook',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}];
V.data=()=>{$('#m').innerHTML=`<h2>Database &amp; settings</h2><h3>Spreadsheet database</h3><p>Every change can be saved automatically into an Excel file (.xlsx) with the sheets Users, Students, Exams, Questions, Results and Answers. ${fh?'<b class=good>Linked: '+esc(fh.name)+'</b>':pfh?'<b class=bad>Link lost after restart – click Reconnect.</b>':'<b>Not linked.</b>'}<br>The file contains password <i>hashes</i> (not passwords): keep it in a protected folder. It is a single-writer file – if two computers edit separate copies, the last save wins. Linking needs Chrome or Edge on http://localhost.</p>
<p class=row><button id=xc>Link spreadsheet file…</button>${pfh?'<button id=xr>Reconnect</button>':''}${fh?'<button id=xn>Save now</button><button id=xu>Unlink</button>':''}<button id=xd>Export .xlsx</button><label class=btn>Import .xlsx<input type=file id=xi accept=.xlsx hidden></label></p>
<p><b class=good>Cloud database:</b> accounts, students, exams, keys and results are saved in your Google Sheet (tabs <i>_db_users, _db_exams, _db_students, _db_results</i>), so every browser and device sees the same data. This local .xlsx file is only an optional extra backup.</p>
<h3>Google Sheets (Apps Script)</h3><p>After every saved scan, exam, key or student change, the app sends the data to your Google Sheet through your Apps Script web app. It <b>automatically creates the tabs</b>: one per <i>teacher + exam + grade/section</i> (students, scores, every answer, with the answer key on top), one <i>KEY</i> tab per exam, and an index tab <i>Index - Teachers</i>. Password hashes are never sent. See README for the 3-step Apps Script setup.</p>
<form id=gf class=grid><label>Web app deployment ID or URL<input name=gid value="${esc(LS('gsId',GS_DEF))}"></label><label>Secret token (optional, must match Code.gs)<input name=gtk value="${esc(LS('gsToken',''))}" autocomplete=off></label><label class=chk><input type=checkbox name=gon${LS('gsOn','1')=='1'?' checked':''}>Auto-sync enabled</label><button>Save</button><button type=button id=gtest>Test connection</button><button type=button id=gall>Sync everything now</button></form><p id=gmsg></p>
<form id=f class=grid><label>School name on answer sheets<input name=school value="${esc(LS('school','School Name'))}"></label><label>Shaded-bubble threshold (0.2–0.9)<input name=thr type=number step=.05 min=.2 max=.9 value="${LS('thr',.5)}"></label><button>Save settings</button></form><p><button id=ca>Clear ALL data</button></p>`;
const gm=(t,c)=>{$('#gmsg').className=c||'';$('#gmsg').textContent=t};
$('#gf').onsubmit=e=>{e.preventDefault();const f=e.target.elements;localStorage.setItem('gsId',f.gid.value.trim());localStorage.setItem('gsToken',f.gtk.value.trim());localStorage.setItem('gsOn',f.gon.checked?'1':'0');gm('Saved.','good')};
$('#gtest').onclick=async()=>{const f=$('#gf').elements;localStorage.setItem('gsId',f.gid.value.trim());localStorage.setItem('gsToken',f.gtk.value.trim());gm('Testing…');
try{const r=await fetch(gsUrl()+'?action=ping&token='+encodeURIComponent(f.gtk.value.trim())),j=await r.json();j.ok?gm('Connected to Google Sheet: '+j.spreadsheet,'good'):gm('Script replied: '+j.error,'bad')}
catch(x){gm('Cannot reach the script ('+(x.message||x)+'). Check the deployment ID, that it is deployed as Web app with access "Anyone", and that you are online.','bad')}};
$('#gall').onclick=async()=>{const f=$('#gf').elements;localStorage.setItem('gsId',f.gid.value.trim());localStorage.setItem('gsToken',f.gtk.value.trim());localStorage.setItem('gsOn',f.gon.checked?'1':'0');if(!gsOn())return gm('Enable auto-sync and enter the deployment ID first.','bad');
await load();const q=gsQ();D.exams.forEach(e=>q.add(e.id));gsSave(q);gm('Sending '+q.size+' exam(s)…');const x=await gsFlush();x.ok?gm('Done – '+x.n+' exam(s) synced. Tabs: '+(x.tabs.join(', ')||'(sent)'),'good'):gm('Failed: '+x.err,'bad')};
$('#f').onsubmit=e=>{e.preventDefault();const f=e.target.elements;localStorage.setItem('school',f.school.value.trim());localStorage.setItem('thr',f.thr.value);alert('Saved')};
$('#xc').onclick=async()=>{if(!window.showSaveFilePicker)return alert('This browser cannot link a file directly (use Chrome or Edge on localhost). Use Export/Import .xlsx instead.');
const mk=confirm('OK = CREATE a new spreadsheet database from the current data.\nCancel = OPEN an existing database file (replaces current data).');
try{if(mk){fh=await showSaveFilePicker({suggestedName:'exam-database.xlsx',types:XT});await meta('fh',fh);await saveXlsx()}else{[fh]=await showOpenFilePicker({types:XT});if(!await applyWb(XLSX.read(await(await fh.getFile()).arrayBuffer()))){fh=null;return}await meta('fh',fh)}go('data')}catch(e){if(e.name!='AbortError')alert('Could not link file: '+e.message)}};
if(pfh)$('#xr').onclick=async()=>{if(await pfh.requestPermission({mode:'readwrite'})=='granted'){fh=pfh;pfh=null;await saveXlsx();go('data')}};
if(fh){$('#xn').onclick=saveXlsx;$('#xu').onclick=async()=>{fh=null;await tx('meta','readwrite',o=>o.delete('fh'));stat('');go('data')}}
$('#xd').onclick=async()=>{await load();XLSX.writeFile(toWb(),'exam-database.xlsx')};
$('#xi').onchange=async x=>{try{if(await applyWb(XLSX.read(await x.target.files[0].arrayBuffer())))go('data')}catch(e){alert('Import failed: '+e.message)}};
$('#ca').onclick=async()=>{if(confirm('Delete ALL users, students, exams, keys and results – on this device AND in the Google Sheet cloud database (all teachers lose their data)? This cannot be undone.')&&confirm('Really delete everything? Export the spreadsheet first if unsure.')){for(const t of S)await clr(t);sessionStorage.clear();location.reload()}}};
/* ---------- boot ---------- */
(async()=>{if(!window.indexedDB)return $('#m').textContent='This browser does not support IndexedDB. Use a current Chrome, Edge or Firefox.';
try{await openDB();await load();const h=await meta('fh');if(h){try{if(await h.queryPermission({mode:'readwrite'})=='granted')fh=h;else{pfh=h;stat('Spreadsheet needs reconnecting (Database & Settings)',1)}}catch{pfh=h}}
await opsLoad();addEventListener('online',()=>{flushOps().catch(()=>{});if(gsQ().size)gsFlush()});setInterval(()=>{if(AUTH&&OPS.some(x=>x.by==AUTH.email))flushOps().catch(()=>{})},60000);
let sa=null;try{sa=JSON.parse(sessionStorage.getItem('auth'))}catch{}
if(sa&&sa.email&&sa.hash&&sessionStorage.getItem('uid')){AUTH=sa;$('#m').textContent='Loading your data…';try{await cloudRefresh()}catch(e){if(!e.net){AUTH=null;sessionStorage.clear()}}}
if(gsOn()&&gsQ().size)setTimeout(gsFlush,1500);
const u=AUTH&&D.users.find(x=>x.id==sessionStorage.getItem('uid')&&x.status=='approved');u?enter(u):(AUTH=null,authView())}catch(e){$('#m').innerHTML='<p class=bad>Database error: '+esc(e.message||e)+'</p>'}})();
