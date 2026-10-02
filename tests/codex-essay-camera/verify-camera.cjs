const fs=require('fs'),assert=require('assert');
const {chromium}=require('C:/Users/MTK/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const sourceDir=process.env.TEACHER_WEB_ROOT||'D:/DeskBox/班级量化考核系统/班级量化考核管理系统网页前后端/admin/teacher/';
const shotDir=process.env.CAMERA_SHOT_DIR||'outputs/essay-camera/';fs.mkdirSync(shotDir,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
 let failThird=false,requests=[],archives=[],delay=40,orientations=0,models=false,jobs=[];
 const html=`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body class="ta-body ta-task-mode"><div id="essay-root" hidden></div><div class="ta-task-body" id="task"></div><section id="sheet" style="position:fixed;inset:20px;z-index:17000;background:white;overflow:auto;display:none"></section><script>
 window.TE={tasks:{}};window.entry={};window.TA={escapeHtml:s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),toForm:o=>new URLSearchParams(o).toString(),request:async(u,o)=>{let r=await fetch(new URL(u,location.href),o);return r.json();},toast:s=>window.lastToast=s,confirm:async()=>true,img:u=>new URL((u.startsWith('../')?u.slice(2):u),location.origin).href,fmtTime:s=>s,closeTask:()=>window.closedTask=true,openSheet:(t,c,ready)=>{let el=document.querySelector('#sheet');el.style.display='block';el.innerHTML='<button id="cancelSheet" onclick="TA.closeSheet()">关闭</button>';if(typeof c==='string')el.innerHTML+=c;else el.append(c);if(ready)ready(el);},closeSheet:()=>{document.querySelector('#sheet').style.display='none';}};
 </script><script src="/camera.js"></script><script>TE.essay.init(document.querySelector('#essay-root'));TE.tasks.camera(document.querySelector('#task'),{},entry);</script></body>`;
 await page.route('https://fixture.test/**',async r=>{
  const url=r.request().url();
  if(url.endsWith('camera.js'))return r.fulfill({contentType:'application/javascript; charset=utf-8',body:fs.readFileSync(sourceDir+'teacher-essay.js','utf8')});
  if(url.includes('/uploads/'))return r.fulfill({contentType:'image/png',body:png});
  if(url.includes('/api/')){
   let data={list:[]};
   if(url.includes('action=students'))data={list:[{id:11,name:'甲同学'},{id:12,name:'乙同学'}]};
   if(url.includes('ocr.php')){
    const body=r.request().postDataBuffer().toString(),n=Number(body.match(/name="page_no"\r\n\r\n(\d+)/)?.[1]);requests.push({n,body});await new Promise(ok=>setTimeout(ok,delay));
    if(n===3&&failThird)return r.abort();
    data={image_url:'../uploads/page'+n+'.png',detected_student_name:n===1?'甲同学':n===3?'乙同学':'',content:'正文'+n,starts_new_essay:n===1||n===3,confidence:0.9,rotation_applied:n===1?90:0,orientation_confidence:'high'};
   }
   if(url.includes('detect_rotation')){orientations++;data={rotation_degrees:90,confidence:'high'};}
   if(url.includes('action=archive')){const p=new URLSearchParams(r.request().postData());archives.push({student:p.get('student_id'),images:JSON.parse(p.get('images'))});data={submission_id:500+archives.length};}
   if(url.includes('action=models'))data={list:models?[{id:'mock',name:'模拟模型'}]:[]};
   if(url.includes('action=job_create')){jobs.push(JSON.parse(r.request().postData()));data={};}
   return r.fulfill({contentType:'application/json; charset=utf-8',body:JSON.stringify({code:0,data})});
  }
  return r.fulfill({contentType:'text/html; charset=utf-8',body:html});
 });
 async function load(){await page.goto('https://fixture.test/admin/teacher/index.php');await page.addStyleTag({content:fs.readFileSync(sourceDir+'teacher.css','utf8')});}
 async function add(n=4){const files=await page.evaluate(n=>Array.from({length:n},(_,i)=>{let c=document.createElement('canvas');c.width=1800;c.height=1000;let x=c.getContext('2d');x.fillStyle=['#eff','white','#ffe','#eef'][i%4];x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='80px sans-serif';x.fillText('Essay '+(i+1),80,200);return c.toDataURL('image/jpeg').split(',')[1];}),n);await page.locator('input[multiple]').setInputFiles(files.map((v,i)=>({name:(i+1)+'.jpg',mimeType:'image/jpeg',buffer:Buffer.from(v,'base64')})));}
 await load();await add();assert(await page.locator('#taCamGrid').innerText().then(t=>t.includes('待分篇照片')));
 assert.equal(await page.locator('.ta-photo-cell').count(),4);
 const width=await page.locator('.ta-ph-preview img').first().evaluate(e=>e.getBoundingClientRect().width);assert(width>280);
 await page.locator('[data-act=view]').first().click();await page.screenshot({path:shotDir+'full-photo-viewer.png'});await page.locator('[data-deg="180"]').click();await page.waitForFunction(()=>!document.querySelector('[data-deg="180"]').disabled);assert.equal(await page.evaluate(()=>entry.onBack()),false);assert.equal(await page.locator('.ta-cam-viewer').count(),0);
 console.log('PASS: 多选4张、大图完整预览、放大旋转180°');
 delay=130;await page.locator('#taCamUpload').click();await page.waitForFunction(()=>document.querySelector('#taCamUpload').disabled);assert.equal(await page.evaluate(()=>entry.onBack()),false);
 await page.waitForFunction(()=>document.querySelector('#taCamMeta').textContent.includes('已识别 4/4'));
 assert.deepEqual(requests.map(x=>x.n),[1,2,3,4]);assert.equal(await page.locator('.ta-gcard').count(),2);
 assert.deepEqual(await page.locator('.ta-gtitle').allTextContents(),['第 1 篇 · 2 页','第 2 篇 · 2 页']);
 await page.screenshot({path:shotDir+'recognized-two-essays.png',fullPage:true});
 assert(requests[1].body.includes('previous_tail'));assert(await page.locator('.ta-ph-preview img').first().getAttribute('src').then(s=>s.includes('/uploads/page1')));
 await page.locator('#taCamUpload').click();assert.equal(requests.length,4);
 await page.locator('#taCamSave').click();await page.waitForFunction(()=>window.closedTask===true);
 assert.deepEqual(archives.map(x=>x.images.length),[2,2]);assert.deepEqual(archives.map(x=>x.student),['11','12']);
 console.log('PASS: 全4页顺序识别、2篇各2页、置信度0.9自动匹配、服务扶正图显示、存档不串学生');
 requests=[];archives=[];failThird=true;await load();await add();await page.locator('#taCamUpload').click();
 await page.waitForFunction(()=>document.querySelector('#taCamMeta').textContent.includes('1 张失败'));
 assert.equal(requests.length,4);assert(await page.locator('.ta-ph-error').innerText().then(s=>s.includes('网络连接中断')));
 await page.screenshot({path:shotDir+'failed-third-page.png',fullPage:true});
 await page.locator('#taCamSave').click();assert.equal(archives.length,0);
 failThird=false;await page.locator('[data-act=retry]').click();await page.waitForFunction(()=>document.querySelector('#taCamMeta').textContent.includes('已识别 4/4'));
 assert.deepEqual(requests.map(x=>x.n),[1,2,3,4,3]);assert.deepEqual(await page.locator('.ta-gtitle').allTextContents(),['第 1 篇 · 2 页','第 2 篇 · 2 页']);
 console.log('PASS: 第3页失败仍处理第4页、错误可见、仅重试第3页、失败前不允许存档');
 archives=[];models=true;await page.locator('#taCamGrade').click();await page.locator('[data-model]').waitFor();assert.equal(archives.length,2);await page.locator('#cancelSheet').click();await page.locator('#taCamGrade').click();await page.locator('[data-model]').click();await page.waitForFunction(()=>window.closedTask===true);
 assert.equal(archives.length,2);assert.equal(jobs.length,1);assert.equal(jobs[0].submission_ids.length,2);console.log('PASS: 存档后取消模型选择，再次批改不重复存档且无未定义函数');
 await load();await page.locator('#taCamMode').selectOption('single_sheet');await add(3);assert.equal(await page.locator('.ta-gcard').count(),3);
 await page.locator('[data-gmerge]').nth(1).click();assert.equal(await page.locator('.ta-gcard').count(),2);
 await page.locator('.ta-photo-cell').nth(1).locator('[data-act=split]').click();assert.equal(await page.locator('.ta-gcard').count(),3);
 console.log('PASS: 整张作文每张一篇、手动合篇/分篇');
 await load();await add(1);await page.locator('#taCamOrient').click();await page.waitForFunction(()=>document.querySelector('#taCamMeta').textContent.includes('已识别 0/1'));
 assert.equal(orientations,1);const notice=await page.locator('.ta-ph-notice').innerText();assert(notice.includes('90'));
 console.log('PASS: 免费方向接口、实际旋转90°，未调用OCR');
 for(const width of [360,390,430])for(const theme of ['ink_blue','bamboo_green','imperial_purple','warm_paper','misty_cyan']){
  await page.setViewportSize({width,height:844});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('[data-act=rot]').first().click({trial:true});
  await page.screenshot({path:shotDir+width+'-'+theme+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('PASS: 三宽度五主题模块无溢出、正常点击；JS errors: 0');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
